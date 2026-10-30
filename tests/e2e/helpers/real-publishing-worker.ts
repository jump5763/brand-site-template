import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { PublishingService } from "../../../../design-coding-agent/src/main/template-publishing/service";
import { PublishingStore } from "../../../../design-coding-agent/src/main/template-publishing/store";
import { SourcePreparation } from "../../../../design-coding-agent/src/main/template-publishing/source-preparation";
import { PreviewCapture } from "../../../../design-coding-agent/src/main/template-publishing/preview-capture";
import { GitHubPublisher } from "../../../../design-coding-agent/src/main/template-publishing/github-publisher";
import { ElectronSecretCipher } from "../../../../design-coding-agent/src/main/settings/electron-secret-cipher";

type Configuration = {
  sourceAppRoot: string; sourceHead: string; nodePath: string; pnpmCliPath: string;
  gitExecutable: string; workDirectory: string; evidenceDirectory: string;
  credentialSourceDb: string; databasePath: string; requestId: string; submissionId: string;
  target: { owner: string; repo: string; branch: string };
  draft: { id: string; templateVersion: string; name: string; description: string; tags: string[] };
};
const configuration = JSON.parse(readFileSync(process.argv.at(-1)!, "utf8")) as Configuration;
app.setName("codeforma");
// A hidden capture window can trigger Electron's default quit behavior.
// The worker owns its lifetime and exits explicitly after saving its result.
app.on("before-quit", (event) => event.preventDefault());
mkdirSync(path.join(path.dirname(configuration.databasePath), "electron-profile"), { recursive: true });
app.setPath("userData", path.join(path.dirname(configuration.databasePath), "electron-profile"));
const save = (name: string, value: unknown): void => {
  writeFileSync(path.join(configuration.evidenceDirectory, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
};

async function run(): Promise<void> {
  assert.notEqual(process.env.CODEFORMA_TEST_FAKE_PROVIDER, "1", "Real publishing forbids the test cipher fallback");
  assert.equal(process.versions.electron, "40.0.0");
  await app.whenReady();
  mkdirSync(configuration.evidenceDirectory, { recursive: true });
  const cipher = new ElectronSecretCipher();
  assert.equal(cipher.isAvailable(), true, "Production OS credential encryption must be available");
  const store = new PublishingStore({ databasePath: configuration.databasePath, cipher });
  let service: PublishingService | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    if (!store.getSettings()) {
      // Open the real production store normally so its ownership lock is enforced.
      // Only public settings/receipt/pending are compared; the token stays in memory.
      const source = new PublishingStore({ databasePath: configuration.credentialSourceDb, cipher });
      try {
        const before = { settings: source.getSettings(), receipt: source.getLastReceipt(), pending: source.getPending() };
        assert.equal(before.pending, null, "An existing production pending submission requires its original owner");
        assert.equal(before.settings?.owner, configuration.target.owner);
        assert.equal(before.settings?.repo, configuration.target.repo);
        assert.equal(before.settings?.branch, configuration.target.branch);
        assert.equal(before.settings?.configured, true);
        store.saveSettings(configuration.target);
        await source.withToken((token) => store.setToken(token));
        assert.deepEqual({ settings: source.getSettings(), receipt: source.getLastReceipt(), pending: source.getPending() }, before);
        save("credential-transfer.json", { productionCipher: true, productionStoreUsed: true,
          originalPublicStateUnchanged: true, credentialValueRecorded: false, target: configuration.target });
      } finally { source.close(); }
    }
    const preparation = new SourcePreparation({ workDirectory: configuration.workDirectory,
      nodePath: configuration.nodePath, pnpmCliPath: configuration.pnpmCliPath, gitExecutable: configuration.gitExecutable,
      resolveAppRoot: () => configuration.sourceAppRoot });
    const capture = new PreviewCapture({ nodePath: configuration.nodePath, pnpmCliPath: configuration.pnpmCliPath });
    service = new PublishingService({ store: () => store, source: preparation,
      capture, publisher: new GitHubPublisher(), workDirectory: configuration.workDirectory });
    let revision = -1;
    const checkpoint = (): void => {
      const state = service!.getState();
      if (state.revision === revision) return;
      revision = state.revision;
      save("publishing-state.json", state);
      if (state.prepared) save("prepared.json", state.prepared);
      if (state.review) save("review.json", state.review);
      process.stdout.write(JSON.stringify({ status: state.status, step: state.step, message: state.message }) + "\n");
    };
    checkpoint();
    timer = setInterval(checkpoint, 500);
    const pending = store.getPending();
    if (pending) {
      assert.equal(pending.submissionId, configuration.submissionId);
      service.reconcile();
      await service.waitForIdle();
      checkpoint();
      assert.equal(service.getState().status, "published", "Unknown remote outcome must be reconciled before any new submission");
    } else if (store.getLastReceipt()?.submissionId !== configuration.submissionId) {
      await service.testTarget();
      service.prepare({ appId: 1, expectedHead: configuration.sourceHead, pagePath: "/", replace: false, requestId: configuration.requestId });
      await service.waitForIdle();
      checkpoint();
      const prepared = service.getState().prepared;
      assert.equal(service.getState().status, "ready", JSON.stringify(service.getState().error));
      assert.ok(prepared);
      const preparedDirectory = readdirSync(configuration.workDirectory).find((name) => name.startsWith("prepared-"));
      assert.ok(preparedDirectory);
      copyFileSync(path.join(configuration.workDirectory, preparedDirectory, "cover.png"), path.join(configuration.evidenceDirectory, "designer-cover.png"));
      const review = await service.review({ preparedId: prepared.preparedId, draft: configuration.draft, mode: "create" });
      save("review.json", review);
      assert.equal(review.baseTemplateTreeSha, null, "The independent acceptance ID must not replace an existing template");
      save("submission.json", { reviewId: review.reviewId, submissionId: configuration.submissionId });
      service.publish({ reviewId: review.reviewId, submissionId: configuration.submissionId });
      await service.waitForIdle();
      checkpoint();
      assert.equal(service.getState().status, "published", JSON.stringify(service.getState().error));
    }
    const receipt = store.getLastReceipt();
    assert.ok(receipt);
    assert.equal(receipt.submissionId, configuration.submissionId);
    assert.equal(receipt.templateId, configuration.draft.id);
    assert.equal(receipt.sourceCommitSha, configuration.sourceHead);
    assert.equal(store.getPending(), null);
    save("receipt.json", receipt);
  } finally {
    if (timer) clearInterval(timer);
    await service?.dispose();
    store.close();
  }
}
void run().then(() => app.exit(0), (error: unknown) => {
  const failure = { name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : "Publishing worker failed" };
  save("publishing-error.json", failure);
  process.stderr.write(JSON.stringify(failure) + "\n");
  app.exit(1);
});
