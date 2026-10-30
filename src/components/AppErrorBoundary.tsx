import React from "react";
import { Icon } from "./Icon";
import { api, isTauri } from "../lib/api";
import { logDiagnostic } from "../lib/diagnostics";
import { APP_ICON_URL, PRODUCT_NAME } from "../lib/branding";

interface State {
  error: Error | null;
  logPath: string | null;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, logPath: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logDiagnostic(
      "error",
      `React render error: ${error.message}\n${error.stack ?? ""}\nComponent stack:${info.componentStack ?? ""}`,
      "react.errorBoundary",
    );
    if (!isTauri) return;
    void api
      .getLogPath()
      .then((logPath) => this.setState({ logPath }))
      .catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const logPath = this.state.logPath;
    return (
      <div className="boot-screen error-boot">
        <div className="boot-card">
          <img className="boot-app-icon" src={APP_ICON_URL} alt="" />
          <h1>{PRODUCT_NAME} hit an interface error</h1>
          <p>The app is still running. The error was written to the local diagnostic log.</p>
          <details className="boot-error-details">
            <summary>Show error details</summary>
            <pre>{this.state.error.message}</pre>
          </details>
          {logPath ? (
            <p className="muted">
              Log file: <code>{logPath}</code>
            </p>
          ) : null}
          <div className="boot-error-actions">
            <button type="button" className="state-button primary" onClick={() => window.location.reload()}>
              <Icon name="refresh" size={14} />
              Reload interface
            </button>
            {logPath ? (
              <button
                type="button"
                className="state-button"
                onClick={() => void api.revealPath(logPath).catch(() => undefined)}
              >
                <Icon name="open" size={14} />
                Reveal log
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}
