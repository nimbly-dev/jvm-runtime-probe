export class CliArgs {
  constructor(private readonly argv: string[]) {}

  get(name: string): string | undefined {
    const idx = this.argv.indexOf(name);
    if (idx === -1) return undefined;
    return this.argv[idx + 1];
  }
}
