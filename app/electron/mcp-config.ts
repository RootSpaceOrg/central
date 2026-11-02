/** Caminho do arquivo --mcp-config que liga sessões do Claude ao MCP da Central (definido quando o servidor sobe). */
let path: string | null = null;

export const setMcpConfigPath = (p: string) => { path = p; };
export const mcpConfigPath = () => path;
