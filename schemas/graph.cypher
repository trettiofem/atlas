// Neo4j schema for the SCIP code graph. Applied by src/load.ts before every load.
// Language-agnostic: everything below comes from SCIP's own model, so any SCIP indexer can feed it.
// Per-language conventions (test files, which kinds are noise) live in src/languages.ts.
//
// Nodes
//   (:Project {root, tool, toolVersion, loadedAt})
//       One per load: the indexed project. root is the absolute directory that File.path is relative to
//       (SCIP metadata.project_root); tool/toolVersion name the indexer; loadedAt is a datetime.
//
//   (:File {path, language, isTest})
//       path      project-relative path, e.g. "src/parse.ts"
//       language  lowercase SCIP language name ("typescript", "python", ...), from the document or else the
//                 file extension; null if unknown
//       isTest    path matches the language's test convention (*.test.ts, test_*.py, *_test.go, src/test/...)
//
//   (:Symbol:<Kind> {id, name, scipKind, scheme, manager, packageName, version, external, doc, file, line,
//                    endLine})
//       Every symbol has the Symbol label plus one kind label, taken from its SCIP descriptor suffix:
//         Namespace      `/`    namespace, package, module (a file's own module symbol is the File node instead)
//         Type           `#`    class, interface, struct, trait, enum, type alias
//         Term           `.`    variable, constant, field, property, enum member
//         Method         `().`  function, method
//         Parameter      `(x)`  function/method parameter
//         TypeParameter  `[T]`  generic type parameter
//         Macro          `!`    macro (Rust, C/C++)
//         Meta           `:`    indexer-specific metadata; dropped for TypeScript/JavaScript, where
//                               scip-typescript uses it for anonymous type-literal members
//       id           SCIP symbol string, unique across the graph
//       name         descriptor name, e.g. "buildGraph"
//       scipKind     detailed SCIP kind ("Class", "Trait", "Constructor", ...) when the indexer sets one;
//                    null otherwise (scip-typescript never does)
//       scheme       indexer that produced the symbol, e.g. "scip-typescript"
//       manager      package manager, e.g. "npm", "maven", "cargo"; null for SCIP's `.` placeholder
//       packageName  defining package; null for `.`
//       version      package version; null for `.`
//       external     true when the symbol is only referenced, not defined, in the indexed project
//       doc       SCIP documentation (hover text), newline-joined
//       file      defining file, for non-external symbols
//       line      1-based line of the definition, for non-external symbols
//       endLine   1-based last line of the definition (end of its SCIP enclosing range), when available
//
// Relationships (all carry {count}: number of occurrences that produced the edge)
//   (:File)-[:DEFINES]->(:Symbol)       definition occurrence
//   (:File)-[:REFERENCES]->(:Symbol)    non-definition occurrence (never to Parameter/TypeParameter)
//   (:File)-[:IMPORTS]->(:File)         derived: references a symbol or module defined in the other file
//   (:Symbol)-[:CONTAINS]->(:Symbol)    nesting, e.g. Type -> Method -> Parameter. From SCIP enclosing ranges, or
//                                       where those are missing, SCIP enclosing_symbol / the descriptor parent
//   (:Symbol)-[:USES]->(:Symbol)        reference inside the source symbol's body (calls, type uses). Needs
//                                       enclosing ranges; the loader warns about files that have none
//   (:Symbol)-[:IMPLEMENTS]->(:Symbol)  SCIP is_implementation (subclass/implementation -> base)
//   (:Symbol)-[:TYPE_OF]->(:Symbol)     SCIP is_type_definition: the source's type is the target (value -> type)

CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE f.path IS UNIQUE;

// One constraint on Symbol covers every kind label. Match `(s:Symbol:Method {...})` rather than `(s:Method {...})`
// so the planner can use these.
CREATE CONSTRAINT symbol_id IF NOT EXISTS FOR (s:Symbol) REQUIRE s.id IS UNIQUE;
CREATE INDEX symbol_name IF NOT EXISTS FOR (s:Symbol) ON (s.name);
