export namespace ai {
  export class RunIdentity {
    repoEpoch: number;
    workspaceId: string;
    conversationId: string;
    runId: string;

    static createFrom(source: any = {}) {
      return new RunIdentity(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.repoEpoch = source['repoEpoch'];
      this.workspaceId = source['workspaceId'];
      this.conversationId = source['conversationId'];
      this.runId = source['runId'];
    }
  }
  export class ActiveRunStatus {
    identity: RunIdentity;
    workspaceLabel: string;
    state: string;

    static createFrom(source: any = {}) {
      return new ActiveRunStatus(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.identity = this.convertValues(source['identity'], RunIdentity);
      this.workspaceLabel = source['workspaceLabel'];
      this.state = source['state'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class CapabilityFacts {
    caps: string[];
    knownCaps: string[];

    static createFrom(source: any = {}) {
      return new CapabilityFacts(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.caps = source['caps'];
      this.knownCaps = source['knownCaps'];
    }
  }
  export class ProviderDestination {
    provider: string;
    model: string;
    endpoint: string;
    classification: string;
    digest: string;

    static createFrom(source: any = {}) {
      return new ProviderDestination(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.provider = source['provider'];
      this.model = source['model'];
      this.endpoint = source['endpoint'];
      this.classification = source['classification'];
      this.digest = source['digest'];
    }
  }
  export class ConsentChallenge {
    id: string;
    identity: RunIdentity;
    destination: ProviderDestination;
    destinationDigest: string;
    expiresAt: number;

    static createFrom(source: any = {}) {
      return new ConsentChallenge(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.id = source['id'];
      this.identity = this.convertValues(source['identity'], RunIdentity);
      this.destination = this.convertValues(source['destination'], ProviderDestination);
      this.destinationDigest = source['destinationDigest'];
      this.expiresAt = source['expiresAt'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class ContextReceipt {
    included: number;
    bytes: number;
    excluded: number;

    static createFrom(source: any = {}) {
      return new ContextReceipt(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.included = source['included'];
      this.bytes = source['bytes'];
      this.excluded = source['excluded'];
    }
  }
  export class ConversationIdentity {
    repoEpoch: number;
    workspaceId: string;
    conversationId: string;

    static createFrom(source: any = {}) {
      return new ConversationIdentity(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.repoEpoch = source['repoEpoch'];
      this.workspaceId = source['workspaceId'];
      this.conversationId = source['conversationId'];
    }
  }
  export class Diagnostic {
    code: string;
    subjectKind: string;
    subjectName: string;
    blocking: boolean;

    static createFrom(source: any = {}) {
      return new Diagnostic(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.code = source['code'];
      this.subjectKind = source['subjectKind'];
      this.subjectName = source['subjectName'];
      this.blocking = source['blocking'];
    }
  }
  export class ModelProjection {
    role: string;
    modelName: string;
    provider: string;
    type: string;
    parameters?: string;
    contextWindow?: number;
    dimensions?: number;
    effectiveCapabilities: string[];
    capabilityFacts: CapabilityFacts;
    exposedCapabilities: string[];
    thinkMode: string;
    routedUseCases: string[];
    removable: boolean;

    static createFrom(source: any = {}) {
      return new ModelProjection(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.role = source['role'];
      this.modelName = source['modelName'];
      this.provider = source['provider'];
      this.type = source['type'];
      this.parameters = source['parameters'];
      this.contextWindow = source['contextWindow'];
      this.dimensions = source['dimensions'];
      this.effectiveCapabilities = source['effectiveCapabilities'];
      this.capabilityFacts = this.convertValues(source['capabilityFacts'], CapabilityFacts);
      this.exposedCapabilities = source['exposedCapabilities'];
      this.thinkMode = source['thinkMode'];
      this.routedUseCases = source['routedUseCases'];
      this.removable = source['removable'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }

  export class ProviderProjection {
    name: string;
    endpoint: string;
    classification: string;
    apiFormat: string;
    credentialState: string;

    static createFrom(source: any = {}) {
      return new ProviderProjection(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.name = source['name'];
      this.endpoint = source['endpoint'];
      this.classification = source['classification'];
      this.apiFormat = source['apiFormat'];
      this.credentialState = source['credentialState'];
    }
  }
  export class RouteProjection {
    useCase: string;
    role: string;

    static createFrom(source: any = {}) {
      return new RouteProjection(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.useCase = source['useCase'];
      this.role = source['role'];
    }
  }

  export class SettingsProjection {
    state: string;
    sourceOrigin: string;
    revision?: string;
    readOnly: boolean;
    editable: boolean;
    routes: RouteProjection[];
    models: ModelProjection[];
    providers: ProviderProjection[];
    diagnostics: Diagnostic[];

    static createFrom(source: any = {}) {
      return new SettingsProjection(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.state = source['state'];
      this.sourceOrigin = source['sourceOrigin'];
      this.revision = source['revision'];
      this.readOnly = source['readOnly'];
      this.editable = source['editable'];
      this.routes = this.convertValues(source['routes'], RouteProjection);
      this.models = this.convertValues(source['models'], ModelProjection);
      this.providers = this.convertValues(source['providers'], ProviderProjection);
      this.diagnostics = this.convertValues(source['diagnostics'], Diagnostic);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class SettingsReloadResult {
    busy: boolean;
    projection: SettingsProjection;

    static createFrom(source: any = {}) {
      return new SettingsReloadResult(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.busy = source['busy'];
      this.projection = this.convertValues(source['projection'], SettingsProjection);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class Status {
    available: boolean;
    workspaceLabel: string;
    identity: ConversationIdentity;
    destination?: ProviderDestination;
    needsConsent: boolean;
    consentChallenge?: ConsentChallenge;
    activeRuns: ActiveRunStatus[];
    warnings?: string[];
    initError?: string;

    static createFrom(source: any = {}) {
      return new Status(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.available = source['available'];
      this.workspaceLabel = source['workspaceLabel'];
      this.identity = this.convertValues(source['identity'], ConversationIdentity);
      this.destination = this.convertValues(source['destination'], ProviderDestination);
      this.needsConsent = source['needsConsent'];
      this.consentChallenge = this.convertValues(source['consentChallenge'], ConsentChallenge);
      this.activeRuns = this.convertValues(source['activeRuns'], ActiveRunStatus);
      this.warnings = source['warnings'];
      this.initError = source['initError'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class StatusRequest {
    repoEpoch: number;
    workspaceId: string;

    static createFrom(source: any = {}) {
      return new StatusRequest(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.repoEpoch = source['repoEpoch'];
      this.workspaceId = source['workspaceId'];
    }
  }
  export class TurnAdmission {
    state: string;
    identity: RunIdentity;
    destination: ProviderDestination;
    context: ContextReceipt;
    consentChallenge?: ConsentChallenge;

    static createFrom(source: any = {}) {
      return new TurnAdmission(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.state = source['state'];
      this.identity = this.convertValues(source['identity'], RunIdentity);
      this.destination = this.convertValues(source['destination'], ProviderDestination);
      this.context = this.convertValues(source['context'], ContextReceipt);
      this.consentChallenge = this.convertValues(source['consentChallenge'], ConsentChallenge);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class TurnRequest {
    identity: RunIdentity;
    message: string;
    contextRefs: string[];
    consentChallengeId?: string;

    static createFrom(source: any = {}) {
      return new TurnRequest(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.identity = this.convertValues(source['identity'], RunIdentity);
      this.message = source['message'];
      this.contextRefs = source['contextRefs'];
      this.consentChallengeId = source['consentChallengeId'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}

export namespace filesystem {
  export class FileContent {
    content: string;
    encoding: string;
    lineEndings: string;
    size: number;
    isBinary: boolean;

    static createFrom(source: any = {}) {
      return new FileContent(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.content = source['content'];
      this.encoding = source['encoding'];
      this.lineEndings = source['lineEndings'];
      this.size = source['size'];
      this.isBinary = source['isBinary'];
    }
  }
  export class FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    // Go type: time
    modTime: any;
    children?: FileEntry[];
    unreadable?: boolean;

    static createFrom(source: any = {}) {
      return new FileEntry(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.name = source['name'];
      this.path = source['path'];
      this.isDir = source['isDir'];
      this.size = source['size'];
      this.modTime = this.convertValues(source['modTime'], null);
      this.children = this.convertValues(source['children'], FileEntry);
      this.unreadable = source['unreadable'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}

export namespace git {
  export class ConflictGuardResult {
    applied: boolean;
    sourceVersion: string;

    static createFrom(source: any = {}) {
      return new ConflictGuardResult(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.applied = source['applied'];
      this.sourceVersion = source['sourceVersion'];
    }
  }
  export class ConflictRegion {
    index: number;
    startLine: number;
    endLine: number;
    ours: string[];
    base: string[];
    theirs: string[];
    hasBase: boolean;
    oursLabel: string;
    theirLabel: string;
    baseEndsWithNewline?: boolean;
    oursEndsWithNewline?: boolean;
    theirsEndsWithNewline?: boolean;

    static createFrom(source: any = {}) {
      return new ConflictRegion(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.index = source['index'];
      this.startLine = source['startLine'];
      this.endLine = source['endLine'];
      this.ours = source['ours'];
      this.base = source['base'];
      this.theirs = source['theirs'];
      this.hasBase = source['hasBase'];
      this.oursLabel = source['oursLabel'];
      this.theirLabel = source['theirLabel'];
      this.baseEndsWithNewline = source['baseEndsWithNewline'];
      this.oursEndsWithNewline = source['oursEndsWithNewline'];
      this.theirsEndsWithNewline = source['theirsEndsWithNewline'];
    }
  }
  export class ConflictSnapshot {
    content: string;
    encoding: string;
    lineEndings: string;
    regions: ConflictRegion[];

    static createFrom(source: any = {}) {
      return new ConflictSnapshot(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.content = source['content'];
      this.encoding = source['encoding'];
      this.lineEndings = source['lineEndings'];
      this.regions = this.convertValues(source['regions'], ConflictRegion);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class StageBlob {
    hash: string;
    mode: string;
    size: number;

    static createFrom(source: any = {}) {
      return new StageBlob(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.hash = source['hash'];
      this.mode = source['mode'];
      this.size = source['size'];
    }
  }
  export class ConflictStages {
    path: string;
    base?: StageBlob;
    ours?: StageBlob;
    theirs?: StageBlob;
    binary: boolean;

    static createFrom(source: any = {}) {
      return new ConflictStages(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.path = source['path'];
      this.base = this.convertValues(source['base'], StageBlob);
      this.ours = this.convertValues(source['ours'], StageBlob);
      this.theirs = this.convertValues(source['theirs'], StageBlob);
      this.binary = source['binary'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class MergeHead {
    label: string;
    hash: string;
    subject: string;

    static createFrom(source: any = {}) {
      return new MergeHead(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.label = source['label'];
      this.hash = source['hash'];
      this.subject = source['subject'];
    }
  }
  export class MergeHeads {
    operation: string;
    ours: MergeHead;
    theirs: MergeHead;

    static createFrom(source: any = {}) {
      return new MergeHeads(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.operation = source['operation'];
      this.ours = this.convertValues(source['ours'], MergeHead);
      this.theirs = this.convertValues(source['theirs'], MergeHead);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class ConflictState {
    stages: ConflictStages;
    snapshot?: ConflictSnapshot;
    heads?: MergeHeads;
    sourceVersion: string;

    static createFrom(source: any = {}) {
      return new ConflictState(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.stages = this.convertValues(source['stages'], ConflictStages);
      this.snapshot = this.convertValues(source['snapshot'], ConflictSnapshot);
      this.heads = this.convertValues(source['heads'], MergeHeads);
      this.sourceVersion = source['sourceVersion'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class FileChange {
    path: string;
    origPath?: string;
    index: string;
    worktree: string;
    unmerged?: boolean;

    static createFrom(source: any = {}) {
      return new FileChange(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.path = source['path'];
      this.origPath = source['origPath'];
      this.index = source['index'];
      this.worktree = source['worktree'];
      this.unmerged = source['unmerged'];
    }
  }
  export class FileContent {
    content: string;
    binary: boolean;
    truncated: boolean;

    static createFrom(source: any = {}) {
      return new FileContent(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.content = source['content'];
      this.binary = source['binary'];
      this.truncated = source['truncated'];
    }
  }
  export class Hunk {
    patch: string;
    newStart: number;
    newLines: number;

    static createFrom(source: any = {}) {
      return new Hunk(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.patch = source['patch'];
      this.newStart = source['newStart'];
      this.newLines = source['newLines'];
    }
  }
  export class FileHunks {
    path: string;
    hunks: Hunk[];

    static createFrom(source: any = {}) {
      return new FileHunks(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.path = source['path'];
      this.hunks = this.convertValues(source['hunks'], Hunk);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }

  export class RepoStatus {
    isRepo: boolean;
    repoRoot: string;
    branch: string;
    upstream: string;
    ahead: number;
    behind: number;
    files: FileChange[];
    detail?: string;

    static createFrom(source: any = {}) {
      return new RepoStatus(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.isRepo = source['isRepo'];
      this.repoRoot = source['repoRoot'];
      this.branch = source['branch'];
      this.upstream = source['upstream'];
      this.ahead = source['ahead'];
      this.behind = source['behind'];
      this.files = this.convertValues(source['files'], FileChange);
      this.detail = source['detail'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}

export namespace lsp {
  export class Position {
    line: number;
    character: number;

    static createFrom(source: any = {}) {
      return new Position(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.line = source['line'];
      this.character = source['character'];
    }
  }
  export class Range {
    start: Position;
    end: Position;

    static createFrom(source: any = {}) {
      return new Range(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.start = this.convertValues(source['start'], Position);
      this.end = this.convertValues(source['end'], Position);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class TextEdit {
    range: Range;
    newText: string;

    static createFrom(source: any = {}) {
      return new TextEdit(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.range = this.convertValues(source['range'], Range);
      this.newText = source['newText'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class CompletionItemLabelDetails {
    detail?: string;
    description?: string;

    static createFrom(source: any = {}) {
      return new CompletionItemLabelDetails(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.detail = source['detail'];
      this.description = source['description'];
    }
  }
  export class CompletionItem {
    label: string;
    kind?: number;
    detail?: string;
    labelDetails?: CompletionItemLabelDetails;
    documentation?: number[];
    insertText?: string;
    insertTextFormat?: number;
    textEdit?: TextEdit;
    filterText?: string;
    sortText?: string;
    commitCharacters?: string[];
    data?: number[];

    static createFrom(source: any = {}) {
      return new CompletionItem(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.label = source['label'];
      this.kind = source['kind'];
      this.detail = source['detail'];
      this.labelDetails = this.convertValues(source['labelDetails'], CompletionItemLabelDetails);
      this.documentation = source['documentation'];
      this.insertText = source['insertText'];
      this.insertTextFormat = source['insertTextFormat'];
      this.textEdit = this.convertValues(source['textEdit'], TextEdit);
      this.filterText = source['filterText'];
      this.sortText = source['sortText'];
      this.commitCharacters = source['commitCharacters'];
      this.data = source['data'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }

  export class CompletionList {
    isIncomplete: boolean;
    items: CompletionItem[];

    static createFrom(source: any = {}) {
      return new CompletionList(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.isIncomplete = source['isIncomplete'];
      this.items = this.convertValues(source['items'], CompletionItem);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class DoctorReport {
    family: string;
    interpreterPath?: string;
    interpreterSource?: string;
    override?: string;
    candidates: string[];

    static createFrom(source: any = {}) {
      return new DoctorReport(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.family = source['family'];
      this.interpreterPath = source['interpreterPath'];
      this.interpreterSource = source['interpreterSource'];
      this.override = source['override'];
      this.candidates = source['candidates'];
    }
  }
  export class DocumentSymbol {
    name: string;
    detail?: string;
    kind: number;
    range: Range;
    selectionRange: Range;
    children?: DocumentSymbol[];

    static createFrom(source: any = {}) {
      return new DocumentSymbol(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.name = source['name'];
      this.detail = source['detail'];
      this.kind = source['kind'];
      this.range = this.convertValues(source['range'], Range);
      this.selectionRange = this.convertValues(source['selectionRange'], Range);
      this.children = this.convertValues(source['children'], DocumentSymbol);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class Hover {
    contents: number[];
    range?: Range;

    static createFrom(source: any = {}) {
      return new Hover(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.contents = source['contents'];
      this.range = this.convertValues(source['range'], Range);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class Location {
    uri: string;
    range: Range;

    static createFrom(source: any = {}) {
      return new Location(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.uri = source['uri'];
      this.range = this.convertValues(source['range'], Range);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }

  export class ServerStatus {
    family: string;
    workspace: string;
    command?: string;
    state: string;
    error?: string;
    completionTriggerCharacters?: string[];
    setupState?: string;
    interpreterPath?: string;
    projectRoot?: string;
    configSource?: string;
    extraPaths?: string[];
    pythonVersion?: string;
    action?: string;
    detailCode?: string;
    provisionPct?: number;

    static createFrom(source: any = {}) {
      return new ServerStatus(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.family = source['family'];
      this.workspace = source['workspace'];
      this.command = source['command'];
      this.state = source['state'];
      this.error = source['error'];
      this.completionTriggerCharacters = source['completionTriggerCharacters'];
      this.setupState = source['setupState'];
      this.interpreterPath = source['interpreterPath'];
      this.projectRoot = source['projectRoot'];
      this.configSource = source['configSource'];
      this.extraPaths = source['extraPaths'];
      this.pythonVersion = source['pythonVersion'];
      this.action = source['action'];
      this.detailCode = source['detailCode'];
      this.provisionPct = source['provisionPct'];
    }
  }
  export class TextDocumentContentChangeEvent {
    range?: Range;
    text: string;

    static createFrom(source: any = {}) {
      return new TextDocumentContentChangeEvent(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.range = this.convertValues(source['range'], Range);
      this.text = source['text'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}

export namespace main {
  export class WorkspaceInfo {
    name: string;
    path: string;
    repoKey: string;
    repoEpoch: number;

    static createFrom(source: any = {}) {
      return new WorkspaceInfo(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.name = source['name'];
      this.path = source['path'];
      this.repoKey = source['repoKey'];
      this.repoEpoch = source['repoEpoch'];
    }
  }
}

export namespace runhistory {
  export class OutputEntry {
    stream: string;
    text: string;
    timestamp: number;

    static createFrom(source: any = {}) {
      return new OutputEntry(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.stream = source['stream'];
      this.text = source['text'];
      this.timestamp = source['timestamp'];
    }
  }
  export class Record {
    version: number;
    historyId: string;
    kind: string;
    profileId: string;
    profileName: string;
    state: string;
    exitCode: number;
    startedAt: number;
    completedAt: number;
    outputAvailable: boolean;
    truncated?: boolean;
    workingDir?: string;
    entries?: OutputEntry[];

    static createFrom(source: any = {}) {
      return new Record(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.version = source['version'];
      this.historyId = source['historyId'];
      this.kind = source['kind'];
      this.profileId = source['profileId'];
      this.profileName = source['profileName'];
      this.state = source['state'];
      this.exitCode = source['exitCode'];
      this.startedAt = source['startedAt'];
      this.completedAt = source['completedAt'];
      this.outputAvailable = source['outputAvailable'];
      this.truncated = source['truncated'];
      this.workingDir = source['workingDir'];
      this.entries = this.convertValues(source['entries'], OutputEntry);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class RecordInput {
    kind: string;
    profileId: string;
    profileName: string;
    state: string;
    exitCode: number;
    startedAt: number;
    completedAt: number;
    workspaceEpoch?: number;
    workingDir?: string;
    entries?: OutputEntry[];
    truncated?: boolean;

    static createFrom(source: any = {}) {
      return new RecordInput(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.kind = source['kind'];
      this.profileId = source['profileId'];
      this.profileName = source['profileName'];
      this.state = source['state'];
      this.exitCode = source['exitCode'];
      this.startedAt = source['startedAt'];
      this.completedAt = source['completedAt'];
      this.workspaceEpoch = source['workspaceEpoch'];
      this.workingDir = source['workingDir'];
      this.entries = this.convertValues(source['entries'], OutputEntry);
      this.truncated = source['truncated'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class Summary {
    historyId: string;
    kind: string;
    profileId: string;
    profileName: string;
    state: string;
    exitCode: number;
    startedAt: number;
    completedAt: number;
    outputAvailable: boolean;
    truncated?: boolean;

    static createFrom(source: any = {}) {
      return new Summary(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.historyId = source['historyId'];
      this.kind = source['kind'];
      this.profileId = source['profileId'];
      this.profileName = source['profileName'];
      this.state = source['state'];
      this.exitCode = source['exitCode'];
      this.startedAt = source['startedAt'];
      this.completedAt = source['completedAt'];
      this.outputAvailable = source['outputAvailable'];
      this.truncated = source['truncated'];
    }
  }
  export class Snapshot {
    version: number;
    summaries: Summary[];
    warning?: string;

    static createFrom(source: any = {}) {
      return new Snapshot(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.version = source['version'];
      this.summaries = this.convertValues(source['summaries'], Summary);
      this.warning = source['warning'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}

export namespace runprofile {
  export class EnvVariant {
    name: string;
    envFile: string;

    static createFrom(source: any = {}) {
      return new EnvVariant(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.name = source['name'];
      this.envFile = source['envFile'];
    }
  }
  export class ProfileUIState {
    adopted?: boolean;
    lastRunAt?: number;

    static createFrom(source: any = {}) {
      return new ProfileUIState(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.adopted = source['adopted'];
      this.lastRunAt = source['lastRunAt'];
    }
  }
  export class RunProfile {
    id: string;
    name: string;
    type: string;
    source: string;
    command?: string;
    workingDir?: string;
    env?: Record<string, string>;
    envFile?: string;
    envVariants?: EnvVariant[];
    activeVariant?: string;
    tags?: string[];
    steps?: string[];
    detectedFrom?: string;
    order?: number;
    workspaceId?: string;
    workspaceName?: string;
    workspaceRelDir?: string;

    static createFrom(source: any = {}) {
      return new RunProfile(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.id = source['id'];
      this.name = source['name'];
      this.type = source['type'];
      this.source = source['source'];
      this.command = source['command'];
      this.workingDir = source['workingDir'];
      this.env = source['env'];
      this.envFile = source['envFile'];
      this.envVariants = this.convertValues(source['envVariants'], EnvVariant);
      this.activeVariant = source['activeVariant'];
      this.tags = source['tags'];
      this.steps = source['steps'];
      this.detectedFrom = source['detectedFrom'];
      this.order = source['order'];
      this.workspaceId = source['workspaceId'];
      this.workspaceName = source['workspaceName'];
      this.workspaceRelDir = source['workspaceRelDir'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class RunProfilesSnapshot {
    profiles: RunProfile[];
    profileState: Record<string, ProfileUIState>;
    workspaceEpoch: number;

    static createFrom(source: any = {}) {
      return new RunProfilesSnapshot(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.profiles = this.convertValues(source['profiles'], RunProfile);
      this.profileState = this.convertValues(source['profileState'], ProfileUIState, true);
      this.workspaceEpoch = source['workspaceEpoch'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class RunStatus {
    runInstanceId: string;
    profileId: string;
    parentRunInstanceId?: string;
    stepIdx: number;
    workspaceEpoch: number;
    launchSeq: number;
    state: string;
    exitCode: number;
    pid?: number;
    timestamp: number;
    reason?: string;

    static createFrom(source: any = {}) {
      return new RunStatus(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.runInstanceId = source['runInstanceId'];
      this.profileId = source['profileId'];
      this.parentRunInstanceId = source['parentRunInstanceId'];
      this.stepIdx = source['stepIdx'];
      this.workspaceEpoch = source['workspaceEpoch'];
      this.launchSeq = source['launchSeq'];
      this.state = source['state'];
      this.exitCode = source['exitCode'];
      this.pid = source['pid'];
      this.timestamp = source['timestamp'];
      this.reason = source['reason'];
    }
  }
  export class ValidationError {
    field: string;
    message: string;

    static createFrom(source: any = {}) {
      return new ValidationError(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.field = source['field'];
      this.message = source['message'];
    }
  }
  export class ValidationResult {
    valid: boolean;
    errors: ValidationError[];

    static createFrom(source: any = {}) {
      return new ValidationResult(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.valid = source['valid'];
      this.errors = this.convertValues(source['errors'], ValidationError);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}

export namespace search {
  export class MatchRange {
    start: number;
    end: number;

    static createFrom(source: any = {}) {
      return new MatchRange(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.start = source['start'];
      this.end = source['end'];
    }
  }
  export class LineMatch {
    line: number;
    column: number;
    text: string;
    submatches: MatchRange[];

    static createFrom(source: any = {}) {
      return new LineMatch(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.line = source['line'];
      this.column = source['column'];
      this.text = source['text'];
      this.submatches = this.convertValues(source['submatches'], MatchRange);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class FileResult {
    path: string;
    relativePath: string;
    matches: LineMatch[];

    static createFrom(source: any = {}) {
      return new FileResult(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.path = source['path'];
      this.relativePath = source['relativePath'];
      this.matches = this.convertValues(source['matches'], LineMatch);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }

  export class SearchOptions {
    regex: boolean;
    caseSensitive: boolean;
    wholeWord: boolean;

    static createFrom(source: any = {}) {
      return new SearchOptions(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.regex = source['regex'];
      this.caseSensitive = source['caseSensitive'];
      this.wholeWord = source['wholeWord'];
    }
  }
  export class SearchRequest {
    requestId: string;
    root: string;
    query: string;
    options: SearchOptions;

    static createFrom(source: any = {}) {
      return new SearchRequest(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.requestId = source['requestId'];
      this.root = source['root'];
      this.query = source['query'];
      this.options = this.convertValues(source['options'], SearchOptions);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class SearchResponse {
    requestId: string;
    status: string;
    message?: string;
    files: FileResult[];
    totalFiles: number;
    totalLines: number;
    truncated: boolean;
    matchCap: number;
    durationMs: number;

    static createFrom(source: any = {}) {
      return new SearchResponse(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.requestId = source['requestId'];
      this.status = source['status'];
      this.message = source['message'];
      this.files = this.convertValues(source['files'], FileResult);
      this.totalFiles = source['totalFiles'];
      this.totalLines = source['totalLines'];
      this.truncated = source['truncated'];
      this.matchCap = source['matchCap'];
      this.durationMs = source['durationMs'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}

export namespace workspace {
  export class FileState {
    path: string;
    cursorLine: number;
    cursorColumn: number;
    scrollTop: number;

    static createFrom(source: any = {}) {
      return new FileState(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.path = source['path'];
      this.cursorLine = source['cursorLine'];
      this.cursorColumn = source['cursorColumn'];
      this.scrollTop = source['scrollTop'];
    }
  }
  export class EditorState {
    activeFilePath: string;
    openFiles: FileState[];

    static createFrom(source: any = {}) {
      return new EditorState(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.activeFilePath = source['activeFilePath'];
      this.openFiles = this.convertValues(source['openFiles'], FileState);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class Explorer {
    expandedPaths: string[];
    rootExpanded: boolean;
    treeSnapshot?: filesystem.FileEntry[];

    static createFrom(source: any = {}) {
      return new Explorer(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.expandedPaths = source['expandedPaths'];
      this.rootExpanded = source['rootExpanded'];
      this.treeSnapshot = this.convertValues(source['treeSnapshot'], filesystem.FileEntry);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }

  export class LSPState {
    interpreterOverride?: string;
    serverPathOverride?: Record<string, string>;

    static createFrom(source: any = {}) {
      return new LSPState(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.interpreterOverride = source['interpreterOverride'];
      this.serverPathOverride = source['serverPathOverride'];
    }
  }
  export class PanelSizes {
    left: number;
    right: number;
    bottom: number;

    static createFrom(source: any = {}) {
      return new PanelSizes(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.left = source['left'];
      this.right = source['right'];
      this.bottom = source['bottom'];
    }
  }
  export class Layout {
    panelSizes: PanelSizes;
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    bottomCollapsed: boolean;

    static createFrom(source: any = {}) {
      return new Layout(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.panelSizes = this.convertValues(source['panelSizes'], PanelSizes);
      this.leftCollapsed = source['leftCollapsed'];
      this.rightCollapsed = source['rightCollapsed'];
      this.bottomCollapsed = source['bottomCollapsed'];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }

  export class State {
    workspacePath: string;
    workspaceName: string;
    lastOpened: string;
    layout: Layout;
    editor: EditorState;
    explorer: Explorer;
    activeSidebar: string;
    hiddenProfileIds?: string[];
    activeWorkspaceId?: string;
    lsp?: LSPState;

    static createFrom(source: any = {}) {
      return new State(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.workspacePath = source['workspacePath'];
      this.workspaceName = source['workspaceName'];
      this.lastOpened = source['lastOpened'];
      this.layout = this.convertValues(source['layout'], Layout);
      this.editor = this.convertValues(source['editor'], EditorState);
      this.explorer = this.convertValues(source['explorer'], Explorer);
      this.activeSidebar = source['activeSidebar'];
      this.hiddenProfileIds = source['hiddenProfileIds'];
      this.activeWorkspaceId = source['activeWorkspaceId'];
      this.lsp = this.convertValues(source['lsp'], LSPState);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ('object' === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class Summary {
    name: string;
    path: string;
    lastOpened: string;

    static createFrom(source: any = {}) {
      return new Summary(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.name = source['name'];
      this.path = source['path'];
      this.lastOpened = source['lastOpened'];
    }
  }
  export class WorkspaceDef {
    id: string;
    name: string;
    relDir: string;
    type: string;
    accent: string;

    static createFrom(source: any = {}) {
      return new WorkspaceDef(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.id = source['id'];
      this.name = source['name'];
      this.relDir = source['relDir'];
      this.type = source['type'];
      this.accent = source['accent'];
    }
  }
}
