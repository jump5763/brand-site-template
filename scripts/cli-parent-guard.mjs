// The fixed publishing CLI must never outlive its Builder and publish late.
if (!process.connected) throw new Error("The local publishing CLI requires a parent IPC channel");
process.once("disconnect", () => {
  // Existing CLI listeners synchronously stop their current compiler child.
  try { process.emit("SIGTERM"); }
  finally { process.exit(1); }
});
// The guard must not keep an otherwise completed CLI alive.
process.channel.unref();
