import { useRef } from "react";
import Editor, { OnMount, loader } from "@monaco-editor/react";

// Configure Monaco loader to use the bundled monaco-editor instead of fetching from CDN.
import * as monaco from "monaco-editor";
loader.config({ monaco });

const langByExt: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", html: "html", css: "css", scss: "scss",
  yml: "yaml", yaml: "yaml", sh: "shell", bash: "shell", zsh: "shell",
  py: "python", go: "go", rs: "rust", java: "java", rb: "ruby", php: "php",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", sql: "sql", xml: "xml",
  toml: "ini", ini: "ini", env: "shell", lock: "yaml",
};

function languageFor(filePath: string): string {
  const name = filePath.split("/").pop() || "";
  if (name === "Dockerfile") return "dockerfile";
  if (name.startsWith(".env")) return "shell";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return langByExt[ext] || "plaintext";
}

export function CodeEditor(props: {
  path: string;
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onMount: OnMount = (editor, m) => {
    editorRef.current = editor;
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => props.onSave?.());
    editor.focus();
  };
  return (
    <Editor
      height="100%"
      theme="vs-dark"
      path={props.path}
      defaultLanguage={languageFor(props.path)}
      language={languageFor(props.path)}
      value={props.value}
      onChange={(v) => props.onChange(v ?? "")}
      onMount={onMount}
      options={{
        readOnly: props.readOnly,
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        renderLineHighlight: "line",
        smoothScrolling: true,
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
}
