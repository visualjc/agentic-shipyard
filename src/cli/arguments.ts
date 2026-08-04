export type ParsedArguments = { positionals: string[]; values: ReadonlyMap<string, string | true>; duplicateOptions: readonly string[] };

/** Small, dependency-free parser for the intentionally narrow v1 command surface. */
export function parseArguments(args: readonly string[]): ParsedArguments {
  const positionals: string[] = [];
  const values = new Map<string, string | true>();
  const duplicateOptions = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    if (equals !== -1) {
      const key = argument.slice(2, equals); if (values.has(key)) duplicateOptions.add(key);
      values.set(key, argument.slice(equals + 1));
      continue;
    }
    const key = argument.slice(2);
    if (values.has(key)) duplicateOptions.add(key);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
    } else values.set(key, true);
  }
  return { positionals, values, duplicateOptions: Object.freeze([...duplicateOptions]) };
}

export function requiredOption(arguments_: ParsedArguments, name: string): string {
  const value = arguments_.values.get(name);
  if (!value || value === true) throw new Error(`Missing required --${name} option.`);
  return value;
}

export function optionalOption(arguments_: ParsedArguments, name: string): string | undefined {
  const value = arguments_.values.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Optional by absence only: presence requires one non-empty explicit value. */
export function explicitOptionalOption(arguments_: ParsedArguments, name: string): string | undefined {
  if (!arguments_.values.has(name)) return undefined;
  const value = arguments_.values.get(name);
  if (value === true || typeof value !== "string" || value.trim() === "") throw new Error(`Option --${name} requires a non-empty value.`);
  return value;
}

/** Mutating commands accept one unambiguous value per exact allowlisted flag. */
export function requireExactCommandShape(arguments_: ParsedArguments, command: string, allowedOptions: readonly string[]): void {
  const allowed = new Set(allowedOptions);
  const unknown = [...arguments_.values.keys()].filter(name => !allowed.has(name));
  if (unknown.length > 0) throw new Error(`${command} rejects unknown option --${unknown[0]}.`);
  if (arguments_.duplicateOptions.length > 0) throw new Error(`${command} rejects duplicate option --${arguments_.duplicateOptions[0]}.`);
  if (arguments_.positionals.length > 0) throw new Error(`${command} rejects unexpected or ambiguous positional values.`);
}
