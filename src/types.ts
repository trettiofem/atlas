/** Decoded SCIP index, as produced by protobufjs `toObject` (camelCase, enums as strings). */
export interface ScipIndex {
    /** `projectRoot` is a file:// URI: the directory the indexer ran in. */
    metadata?: { projectRoot?: string; toolInfo?: { name?: string; version?: string } };
    documents?: ScipDocument[];
    externalSymbols?: ScipSymbolInfo[];
}

export interface ScipDocument {
    relativePath: string;
    /** SCIP `Language` name; scip-typescript leaves it empty. */
    language?: string;
    occurrences?: ScipOccurrence[];
    symbols?: ScipSymbolInfo[];
}

export interface ScipOccurrence {
    range?: number[];
    symbol: string;
    symbolRoles?: number;
    enclosingRange?: number[];
}

export interface ScipSymbolInfo {
    symbol: string;
    documentation?: string[];
    /** SCIP `SymbolInformation.Kind` enum name, e.g. "Class"; scip-typescript leaves it empty. */
    kind?: string;
    displayName?: string;
    enclosingSymbol?: string;
    relationships?: { symbol: string; isImplementation?: boolean; isTypeDefinition?: boolean }[];
}

export interface FileNode {
    path: string;
    /** Lowercase SCIP language name, from the document or else the file extension. */
    language?: string;
    isTest: boolean;
}

/** SCIP descriptor kinds, from the descriptor suffix: `/` `#` `.` `().` `:` `!` `(x)` `[T]`. */
export type DescriptorKind = "Namespace" | "Type" | "Term" | "Method" | "Meta" | "Macro" | "Parameter" | "TypeParameter";

/** Descriptor kinds that become nodes; each is a node label next to `Symbol`, e.g. `(:Symbol:Method)`. */
export const NODE_KINDS = [
    "Namespace", "Type", "Term", "Method", "Parameter", "TypeParameter", "Macro", "Meta",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export interface SymbolNode {
    id: string;
    name: string;
    /** Node label; undefined when the descriptor can't be parsed (the node is then only `:Symbol`). */
    kind?: NodeKind;
    /** Detailed SCIP kind (e.g. "Class", "Trait", "Constructor") when the indexer provides one. */
    scipKind?: string;
    /** Indexer that produced the symbol, e.g. "scip-typescript". */
    scheme: string;
    /** Package coordinates of the defining package; undefined where SCIP uses the `.` placeholder. */
    manager?: string;
    packageName?: string;
    version?: string;
    external: boolean;
    doc: string;
    file?: string;
    line?: number;
    /** 1-based last line of the definition (from its enclosing range), when the indexer emits one. */
    endLine?: number;
}

export interface Edge {
    from: string;
    to: string;
    count?: number;
}

/** The indexed project; stored as a single `(:Project)` node per load. */
export interface ProjectInfo {
    /** Absolute path that File paths are relative to. */
    root?: string;
    tool?: string;
    toolVersion?: string;
}

export interface Graph {
    project: ProjectInfo;
    files: FileNode[];
    symbols: SymbolNode[];
    defines: Edge[]; // File -> Symbol (any kind, including Parameter/TypeParameter)
    references: Edge[]; // File -> Symbol (non-definition occurrences; not to Parameter/TypeParameter)
    imports: Edge[]; // File -> File (derived: references a symbol defined in another file)
    contains: Edge[]; // Symbol -> Symbol (lexical nesting, e.g. Type -> Method -> Parameter)
    uses: Edge[]; // Symbol -> Symbol (reference occurs inside the body of the source symbol; not to parameters)
    implements: Edge[]; // Symbol -> Symbol (SCIP is_implementation)
    typeOf: Edge[]; // Symbol -> Symbol (SCIP is_type_definition: the source's type is the target)
    /** Files with definitions but no enclosing ranges: their USES edges are missing, only REFERENCES remain. */
    filesWithoutScopes: string[];
}