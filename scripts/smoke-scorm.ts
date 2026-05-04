// Quick smoke test for the SCORM analyzer. Creates a tiny in-memory SCORM 1.2
// package (manifest + a couple of HTML pages) and runs analyzeScormPackage.

import JSZip from "jszip";
import { analyzeScormPackage } from "../server/scorm/analyze.js";

async function buildSamplePackage(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "imsmanifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MAN-1" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Smoke Course</title>
      <item identifier="I-1" identifierref="R-1"><title>Welcome</title>
        <item identifier="I-1-1" identifierref="R-2"><title>Topic A</title></item>
      </item>
      <item identifier="I-2" identifierref="R-3"><title>Goodbye</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="R-1" type="webcontent" adlcp:scormtype="sco" href="welcome.html">
      <file href="welcome.html"/>
    </resource>
    <resource identifier="R-2" type="webcontent" adlcp:scormtype="sco" href="pages/topic-a.html">
      <file href="pages/topic-a.html"/>
    </resource>
    <resource identifier="R-3" type="webcontent" adlcp:scormtype="sco" href="goodbye.html">
      <file href="goodbye.html"/>
    </resource>
  </resources>
</manifest>`,
  );
  zip.file(
    "welcome.html",
    `<!DOCTYPE html><html><body>
    <h1>Welcome</h1>
    <p>Visit <a href="https://example.com/">our docs</a> and
    <a href="missing-page.html">the next chapter</a>.</p>
    <img src="https://httpbin.org/image/png" alt="logo">
    </body></html>`,
  );
  zip.file(
    "pages/topic-a.html",
    `<!DOCTYPE html><html><body>
    <h1>Topic A</h1>
    <p>Read more at https://www.iana.org/help/example-domains.</p>
    <a href="../welcome.html">Back to start</a>
    </body></html>`,
  );
  zip.file(
    "goodbye.html",
    `<!DOCTYPE html><html><body>
    <h1>Thank you!</h1>
    <iframe src="https://example.org/embed"></iframe>
    </body></html>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function main() {
  const buffer = await buildSamplePackage();
  const report = await analyzeScormPackage(buffer, {
    filename: "smoke.zip",
    checkUrls: false,
  });
  console.log("scormVersion:", report.scormVersion);
  console.log("title:", report.title);
  console.log("totals:", report.totals);
  console.log("orgs:", report.organizations.length, "items in org-1:", report.organizations[0]?.items.length);
  console.log("external URLs:", report.externalUrls.map((e) => e.url));
  console.log("internal issues:", report.internalIssues);
  console.log("assets.byGroup:", report.assets.byGroup);
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exit(1);
});
