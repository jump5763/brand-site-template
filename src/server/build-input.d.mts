export interface BuildSite {
  id: string;
  name?: string;
  templateId: string;
  hostname: string;
  siteUrl?: string;
  contentFile: string;
}
export function getBuildSites(root?: string): BuildSite[];
export function sitesForTemplate(templateId: string, root?: string): BuildSite[];
export function readBuildDocument(templateId: string, siteId: string, root?: string): Promise<unknown>;
export function readPreviewDocument(templateId: string, root?: string): Promise<unknown>;
