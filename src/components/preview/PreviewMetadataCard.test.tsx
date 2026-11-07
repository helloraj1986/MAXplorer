// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import React from "react";
import { act, render } from "@testing-library/react";
import { PreviewMetadataCard } from "./PreviewMetadataCard";
import { useExplorerStore } from "../../state/explorerStore";
import type { FileEntry, PreviewMetadata } from "../../lib/types";

const entry: FileEntry = {
  name: "untagged.txt",
  path: "/Users/test/untagged.txt",
  isDir: false,
  isSymlink: false,
  size: 10,
  modified: 1,
  created: 1,
  accessed: 1,
  extension: "txt",
  isHidden: false,
  isReadOnly: false,
  target: null,
};

const metadata: PreviewMetadata = {
  path: entry.path,
  name: entry.name,
  extension: "txt",
  contentType: "text/plain",
  contentTypeTree: [],
  kind: "Plain Text",
  size: 10,
  isDir: false,
  isSymlink: false,
  isReadable: true,
  isPackage: false,
  isICloudPlaceholder: false,
  isNetworkVolume: false,
  modified: 1,
  created: 1,
  duration: null,
  width: null,
  height: null,
  codecs: [],
  pageCount: null,
  tags: [],
  quickLookSupported: true,
};

/** Mirrors AppErrorBoundary so a render loop surfaces as a caught message. */
class Capture extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <span>caught: {this.state.error.message}</span> : this.props.children;
  }
}

describe("PreviewMetadataCard", () => {
  it("returns the same tag snapshot on every read for an untagged path", () => {
    const state = useExplorerStore.getState();
    expect(state.tagIdsForPath(entry.path)).toBe(state.tagIdsForPath(entry.path));
  });

  it("survives an unrelated store change without a render loop", () => {
    const { container } = render(
      <Capture>
        <PreviewMetadataCard entry={entry} metadata={metadata} />
      </Capture>,
    );
    act(() => {
      useExplorerStore.setState({ toasts: [{ id: "t1", message: "ping", tone: "info" } as never] });
    });
    expect(container.textContent).not.toContain("caught:");
  });
});
