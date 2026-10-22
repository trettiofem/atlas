import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_INDEX, index } from "./index.js";
import { loadGraph } from "./load.js";
import { withDriver } from "./neo4j.js";
import { isQueryCommand, overview, QUERY_USAGE, runQuery } from "./queries.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string", short: "p", default: projectRoot },
      file: { type: "string", short: "f" },
      kind: { type: "string", short: "k" },
    },
  });
  const [cmd, arg, depth] = positionals;
  switch (cmd) {
    case "index":
      return index(values.project, arg);
    case "load":
      return console.log(await withDriver((d) => loadGraph(d, arg ?? DEFAULT_INDEX)));
    case "sync":
      index(values.project);
      return console.log(await withDriver((d) => loadGraph(d, DEFAULT_INDEX)));
    case "overview":
      return console.dir(await withDriver(overview), { depth: null });
  }
  if (isQueryCommand(cmd) && arg) {
    const rows = await withDriver((d) => runQuery(d, cmd, arg, { depth, file: values.file, kind: values.kind }));
    return rows.length ? console.table(rows) : console.log("(no results)");
  }
  console.error(USAGE);
  process.exitCode = 1;
}

const USAGE = `Usage: pnpm graph <command> [args]

  index [file]   run scip-typescript, writing index.scip
  load [file]    load a SCIP index into Neo4j (replaces the existing graph)
  sync           index + load

Options:
  -p, --project <dir>   project to index (default: this repo), e.g. example-project.
                        Every directory with a tsconfig.json is indexed.
  -f, --file <path>     restrict name-based queries to symbols defined in this file
  -k, --kind <label>    restrict search to a kind label, e.g. Method

${QUERY_USAGE}`;

await main();
