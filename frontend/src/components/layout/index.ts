export { IDEShell } from './IDEShell';
export { Panel, PanelAction } from './Panel';
export { ResizeHandle } from './ResizeHandle';
// `RightPanel` is deliberately absent: it composes features (Golem, Runs)
// rather than offering a layout primitive, and re-exporting it here put the
// whole feature tree behind every `../layout` import — a cycle for anything
// those features already import. Import it by module path.
