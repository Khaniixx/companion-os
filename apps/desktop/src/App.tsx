import { useEffect, useState } from "react";

import { CompanionWorkspace } from "./components/CompanionWorkspace";
import { InstallOpenClaw } from "./components/InstallOpenClaw";
import { installerApi } from "./installerApi";

export default function App() {
  const [installerResolved, setInstallerResolved] = useState(false);
  const [showCompanionWorkspace, setShowCompanionWorkspace] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadInstallerStatus(): Promise<void> {
      try {
        const status = await installerApi.getInstallerStatus();

        if (!active) {
          return;
        }

        setShowCompanionWorkspace(status.connection.connected);
      } catch {
        if (!active) {
          return;
        }

        setShowCompanionWorkspace(false);
      } finally {
        if (active) {
          setInstallerResolved(true);
        }
      }
    }

    void loadInstallerStatus();

    return () => {
      active = false;
    };
  }, []);

  if (!installerResolved) {
    return (
      <main className="installer-shell installer-shell--loading">
        <section className="installer-hero">
          <div className="installer-copy">
            <span className="eyebrow">Companion OS</span>
            <h1>Loading the local companion environment.</h1>
            <p>
              Checking whether OpenClaw is already installed and connected.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!showCompanionWorkspace) {
    return (
      <InstallOpenClaw
        onComplete={() => {
          setShowCompanionWorkspace(true);
        }}
      />
    );
  }

  return <CompanionWorkspace />;
}
