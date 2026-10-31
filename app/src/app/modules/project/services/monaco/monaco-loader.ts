/** Carrega o Monaco (build AMD copiado para /vs) uma vez só e aplica o tema da Central. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Monaco = any;

let loading: Promise<Monaco> | null = null;

export function loadMonaco(): Promise<Monaco> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vs/loader.js';
    script.onerror = () => reject(new Error('Não foi possível carregar o editor.'));
    script.onload = () => {
      const amd = (window as unknown as { require: any }).require;
      amd.config({ paths: { vs: 'vs' } });
      amd(['vs/editor/editor.main'], () => {
        const monaco = (window as unknown as { monaco: Monaco }).monaco;
        monaco.editor.defineTheme('central-night', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '5D6679', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'B48CFF' },
            { token: 'string', foreground: '3FBF8A' },
            { token: 'number', foreground: 'E0B44C' },
            { token: 'type', foreground: '4CC9F0' },
          ],
          colors: {
            'editor.background': '#141922',
            'editor.foreground': '#E6E9EF',
            'editor.lineHighlightBackground': '#1A202B',
            'editorLineNumber.foreground': '#4A5366',
            'editorLineNumber.activeForeground': '#8A93A6',
            'editor.selectionBackground': '#7FA2FF44',
            'editorCursor.foreground': '#7FA2FF',
            'editorIndentGuide.background1': '#222A38',
            'editorWidget.background': '#1A202B',
            'editorWidget.border': '#2B3445',
            'minimap.background': '#141922',
            'scrollbarSlider.background': '#2B344588',
          },
        });
        resolve(monaco);
      }, reject);
    };
    document.head.appendChild(script);
  });
  return loading;
}
