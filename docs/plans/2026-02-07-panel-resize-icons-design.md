# Issues #33 & #34: Panel Resize & Icon System — Design

**Goal:** Add drag-to-resize and collapse/expand for all three panel boundaries, and fix folder icon colors for visibility and distinction on dark backgrounds.

**Architecture:** A reusable `useResize` hook manages mousedown/mousemove/mouseup on thin drag handles placed in the CSS Grid gaps. Collapse buttons (chevrons) at each boundary toggle panels. Folder colors switch to a warm, high-contrast palette with distinct open/closed variants per folder type.

---

## Panel Resize System (Issue #33)

### Resize Hook — `useResize`

A single hook that takes configuration and returns mouse handlers:

```typescript
interface UseResizeOptions {
  direction: 'horizontal' | 'vertical';
  cssVar: string;           // e.g. '--panel-left-width'
  min: number;              // minimum px
  max: number;              // maximum px
  inverted?: boolean;       // true for right panel (drag left = larger)
}
```

The hook:
1. On mousedown, captures start position and current CSS var value
2. On mousemove, computes delta, clamps to min/max, sets CSS var on `document.documentElement`
3. On mouseup, cleans up listeners
4. No React re-renders during drag — direct DOM style mutation

### Three Resize Handles

| Boundary | CSS Variable | Direction | Inverted | Min | Max |
|----------|-------------|-----------|----------|-----|-----|
| Left/Center | `--panel-left-width` | horizontal | no | 150px | 500px |
| Center/Bottom | `--panel-bottom-height` | vertical | yes | 80px | 500px |
| Center/Right | `--panel-right-width` | horizontal | yes | 150px | 500px |

### Drag Handle Component — `ResizeHandle`

A thin (6px wide/tall) invisible hit target positioned in the CSS Grid gap between panels:
- Shows a 2px accent-colored indicator line on hover
- Cursor changes to `col-resize` (horizontal) or `row-resize` (vertical)
- Sits in the existing `--panel-gap` (6px) space

### Collapse Buttons

Small chevron buttons positioned at each resize handle:
- Left/Center: collapses left panel (extends existing `isLeftPanelCollapsed`)
- Center/Bottom: new `isBottomPanelCollapsed` in store
- Center/Right: new `isRightPanelCollapsed` in store

Clicking stores the pre-collapse size and sets the panel to 0px + hidden.
Clicking again restores the stored size.

### Layout Changes

`IDEShell.tsx` and `IDEShell.module.css` need updates:
- Resize handles rendered between panel sections
- Collapse buttons positioned at handle midpoints
- Grid template responds to collapsed state for all three panels (currently only left)

---

## Icon & Folder Color Fixes (Issue #34)

### Warm Folder Color Palette

Replace the current low-contrast palette with distinct, high-saturation colors:

| Folder Type | Closed | Open (lighter) | Hue |
|-------------|--------|----------------|-----|
| `default` | `#d97706` | `#f59e0b` | Amber |
| `src` | `#3B82F6` | `#60a5fa` | Blue |
| `components` | `#a855f7` | `#c084fc` | Purple |
| `hooks` | `#ec4899` | `#f472b6` | Pink |
| `node_modules` | `#6B7280` | `#9ca3af` | Gray |
| `test` | `#22c55e` | `#4ade80` | Green |
| `docs` | `#06b6d4` | `#22d3ee` | Cyan |
| `public` | `#f97316` | `#fb923c` | Orange |
| `dist` | `#6B7280` | `#9ca3af` | Gray |

Key changes:
- Default amber instead of invisible dark teal
- Open folders get a lighter variant of their type-specific color (not a flat teal)
- Every type has a unique hue for instant visual distinction
- All colors have enough brightness to pop against `#060a0e` panel background

### Sidebar Active Indicator

Already implemented — `Sidebar.module.css` has the `::before` pseudo-element with accent-colored 3px bar, matching flux-ml's pattern.

### Devicon Dark Background Fixes

Some devicons (e.g., `MarkdownOriginal`) have dark fills that are invisible on the near-black panel background. These need a brightness filter or swap to a light variant.

---

## Files to Modify

### Issue #33 (Panel Resize)
- Create: `frontend/src/hooks/useResize.ts`
- Create: `frontend/src/components/layout/ResizeHandle.tsx`
- Create: `frontend/src/components/layout/ResizeHandle.module.css`
- Modify: `frontend/src/components/layout/IDEShell.tsx`
- Modify: `frontend/src/components/layout/IDEShell.module.css`
- Modify: `frontend/src/stores/ideStore.ts` (add right/bottom collapse state)
- Modify: `frontend/src/components/layout/index.ts` (export ResizeHandle)
- Tests: `frontend/src/__tests__/hooks/useResize.test.ts`
- Tests: `frontend/src/__tests__/components/layout/ResizeHandle.test.tsx`

### Issue #34 (Icons)
- Modify: `frontend/src/components/FileExplorer/FileIcon.tsx` (new color palette)
- Modify: `frontend/src/styles/tokens.css` (update folder color tokens)
- Tests: Update `frontend/src/__tests__/components/FileExplorer/FileIcon.test.tsx`
