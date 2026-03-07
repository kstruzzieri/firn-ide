import './styles/tokens.css';
import './styles/reset.css';
import { IDEShell } from './components/layout';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { FileExplorer } from './components/FileExplorer';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { RunProfiles } from './components/RunProfiles';
import { StatusBar } from './components/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toast } from './components/Toast';
import { useAutosave } from './hooks/useAutosave';
import { useRunProfilesLoader } from './hooks/useRunProfiles';
import { useWorkspace } from './stores/ideStore';

function App() {
  useAutosave();
  const workspace = useWorkspace();
  useRunProfilesLoader(workspace?.path);

  return (
    <ErrorBoundary>
      <IDEShell
        accent="project"
        header={<Header />}
        sidebar={<Sidebar />}
        leftPanel={<FileExplorer />}
        centerPanel={<Editor />}
        bottomPanel={<Terminal />}
        rightPanel={<RunProfiles />}
        statusBar={<StatusBar />}
      />
      <Toast />
    </ErrorBoundary>
  );
}

export default App;
