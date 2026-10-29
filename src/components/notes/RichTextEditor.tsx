import { useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { colors } from "@/lib/theme";
import { Icon, type IconName } from "@/components/ui";

// A contentEditable document in a WebView. It emits plain semantic HTML
// (p, h1–h3, ul/ol/li, blockquote, pre, strong/b, em/i, u, s, a), which the
// web app's Tiptap editor parses as-is — notes round-trip between the two.

type Format = {
  bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  block: string; ul: boolean; ol: boolean;
};

const EMPTY_FORMAT: Format = { bold: false, italic: false, underline: false, strike: false, block: "p", ul: false, ol: false };

function editorHtml(content: string, placeholder: string) {
  const initial = JSON.stringify(content || "");
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;background:${colors.bg};color:${colors.onSurface};font:16px/1.6 -apple-system,system-ui,Roboto,sans-serif;-webkit-text-size-adjust:100%}
  #ed{min-height:100vh;padding:16px 20px 120px;outline:none;box-sizing:border-box;word-wrap:break-word}
  #ed:empty:before{content:attr(data-placeholder);color:${colors.placeholder}}
  h1{font-size:1.6em;margin:.6em 0 .3em}h2{font-size:1.3em;margin:.6em 0 .3em}h3{font-size:1.1em;margin:.6em 0 .3em}
  p{margin:.35em 0}ul,ol{padding-left:1.4em;margin:.35em 0}
  blockquote{border-left:3px solid ${colors.primaryContainer};margin:.5em 0;padding-left:12px;color:${colors.onSurfaceVariant}}
  pre{background:${colors.surfaceLow};border-radius:8px;padding:10px 12px;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:14px}
  a{color:${colors.primary}}
</style></head><body>
<div id="ed" contenteditable="true" data-placeholder="${placeholder.replace(/"/g, "&quot;")}"></div>
<script>
  var ed = document.getElementById('ed');
  ed.innerHTML = ${initial};
  document.execCommand('defaultParagraphSeparator', false, 'p');
  function post(m){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function html(){ var h = ed.innerHTML; return h === '<br>' || h === '<p><br></p>' ? '' : h; }
  function block(){
    var n = window.getSelection().anchorNode;
    while (n && n !== ed) { if (n.nodeType === 1 && /^(H1|H2|H3|BLOCKQUOTE|PRE)$/.test(n.nodeName)) return n.nodeName.toLowerCase(); n = n.parentNode; }
    return 'p';
  }
  function state(){
    post({ type:'state', format:{
      bold:document.queryCommandState('bold'), italic:document.queryCommandState('italic'),
      underline:document.queryCommandState('underline'), strike:document.queryCommandState('strikeThrough'),
      ul:document.queryCommandState('insertUnorderedList'), ol:document.queryCommandState('insertOrderedList'),
      block:block() } });
  }
  ed.addEventListener('input', function(){ if (!ed.firstChild) document.execCommand('formatBlock', false, 'p'); post({type:'change', html:html()}); state(); });
  document.addEventListener('selectionchange', state);
  window.cmd = function(name, value){
    ed.focus();
    if (name === 'formatBlock') { document.execCommand('formatBlock', false, block() === value ? 'p' : value); }
    else document.execCommand(name, false, value || null);
    post({type:'change', html:html()}); state();
  };
  ${"" /* focus on open */}
  setTimeout(function(){ ed.focus(); var r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }, 300);
  true;
</script></body></html>`;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = "Start writing…",
}: {
  /** Read once on mount — remount (key) to load another note */
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const web = useRef<WebView>(null);
  const [format, setFormat] = useState<Format>(EMPTY_FORMAT);
  // Only the initial content goes into the page; later edits live in the WebView
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = useMemo(() => ({ html: editorHtml(content, placeholder) }), []);

  function run(name: string, value?: string) {
    web.current?.injectJavaScript(`window.cmd(${JSON.stringify(name)}, ${JSON.stringify(value ?? null)}); true;`);
  }

  function onMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type: string; html?: string; format?: Format };
      if (msg.type === "change" && msg.html !== undefined) onChange(msg.html);
      if (msg.type === "state" && msg.format) setFormat(msg.format);
    } catch { /* ignore */ }
  }

  function addLink() {
    Alert.prompt("Link", "Paste a URL", (url) => {
      if (url) run("createLink", /^https?:\/\//.test(url) ? url : `https://${url}`);
    });
  }

  // Plain data — the press handler below turns a button into an editor command
  const buttons: { key: string; icon?: IconName; label?: string; active: boolean; cmd: [string, string?] | "link" }[] = [
    { key: "b", icon: "bold", active: format.bold, cmd: ["bold"] },
    { key: "i", icon: "italic", active: format.italic, cmd: ["italic"] },
    { key: "u", icon: "underline", active: format.underline, cmd: ["underline"] },
    { key: "s", label: "S̶", active: format.strike, cmd: ["strikeThrough"] },
    { key: "h1", label: "H1", active: format.block === "h1", cmd: ["formatBlock", "h1"] },
    { key: "h2", label: "H2", active: format.block === "h2", cmd: ["formatBlock", "h2"] },
    { key: "h3", label: "H3", active: format.block === "h3", cmd: ["formatBlock", "h3"] },
    { key: "ul", icon: "list", active: format.ul, cmd: ["insertUnorderedList"] },
    { key: "ol", label: "1.", active: format.ol, cmd: ["insertOrderedList"] },
    { key: "q", label: "❝", active: format.block === "blockquote", cmd: ["formatBlock", "blockquote"] },
    { key: "code", label: "</>", active: format.block === "pre", cmd: ["formatBlock", "pre"] },
    // Alert.prompt is iOS-only
    ...(Platform.OS === "ios" ? [{ key: "link", icon: "link" as IconName, active: false, cmd: "link" as const }] : []),
  ];

  function press(cmd: [string, string?] | "link") {
    if (cmd === "link") addLink();
    else run(cmd[0], cmd[1]);
  }

  return (
    <View className="flex-1">
      <View className="border-b border-divider">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerClassName="px-2 py-1.5 gap-1">
          {buttons.map((b) => (
            <Pressable
              key={b.key}
              onPress={() => press(b.cmd)}
              className={`min-w-9 h-9 px-2 rounded-lg items-center justify-center ${b.active ? "bg-on-primary-container" : "active:bg-surface-high"}`}
            >
              {b.icon ? (
                <Icon name={b.icon} size={16} color={b.active ? colors.primary : colors.outline} strokeWidth={2} />
              ) : (
                <Text className={`text-sm font-semibold ${b.active ? "text-primary" : "text-outline"}`}>{b.label}</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <WebView
        ref={web}
        originWhitelist={["*"]}
        source={source}
        onMessage={onMessage}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        style={{ flex: 1, backgroundColor: colors.bg }}
        containerStyle={{ backgroundColor: colors.bg }}
      />
    </View>
  );
}
