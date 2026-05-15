import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Dashboard } from "./routes/Dashboard.js";
import { ProfileDetail } from "./routes/ProfileDetail.js";
import { ProfileList } from "./routes/ProfileList.js";
import { ProjectCreate } from "./routes/ProjectCreate.js";
import { ProjectList } from "./routes/ProjectList.js";
import { ProjectSettings } from "./routes/ProjectSettings.js";
import { ProjectShell } from "./routes/ProjectShell.js";
import { RunDetail } from "./routes/RunDetail.js";
import { RunHistory } from "./routes/RunHistory.js";
import { AiTab } from "./routes/settings/AiTab.js";
import { CaptureTab } from "./routes/settings/CaptureTab.js";
import { ConnectorsTab } from "./routes/settings/ConnectorsTab.js";
import { DangerTab } from "./routes/settings/DangerTab.js";
import { GeneralTab } from "./routes/settings/GeneralTab.js";
import { SourceTab } from "./routes/settings/SourceTab.js";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/projects/new" element={<ProjectCreate />} />
        <Route path="/projects/:slug" element={<ProjectShell />} />
        <Route path="/projects/:slug/settings" element={<ProjectSettings />}>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<GeneralTab />} />
          <Route path="source" element={<SourceTab />} />
          <Route path="ai" element={<AiTab />} />
          <Route path="connectors" element={<ConnectorsTab />} />
          <Route path="capture" element={<CaptureTab />} />
          <Route path="danger" element={<DangerTab />} />
        </Route>
        <Route path="/profiles" element={<ProfileList />} />
        <Route path="/profiles/:profileId" element={<ProfileDetail />} />
        <Route path="/projects/:slug/profiles" element={<ProfileList />} />
        <Route path="/projects/:slug/profiles/:profileId" element={<ProfileDetail />} />
        <Route path="/projects/:slug/runs" element={<RunHistory />} />
        <Route path="/runs/:id" element={<RunDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
