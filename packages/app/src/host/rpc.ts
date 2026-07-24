/** Newline-delimited JSON framing for the engine-host stdio channel. */
export class LineCodec {
  private buffer = '';

  push(chunk: string | Buffer): string[] {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.filter((l) => l.trim() !== '');
  }
}

export function encodeLine(msg: unknown): string {
  return JSON.stringify(msg) + '\n';
}

export function decodeLine<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}
