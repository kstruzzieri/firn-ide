import * as fs from 'fs';
import * as path from 'path';

describe('Architecture Documentation', () => {
  // __dirname = frontend/src/__tests__
  // Go up 3 levels to reach project root, then into docs
  const docsDir = path.join(__dirname, '../../..', 'docs');
  const architecturePath = path.join(docsDir, 'ARCHITECTURE.md');

  it('should have ARCHITECTURE.md', () => {
    const exists = fs.existsSync(architecturePath);
    expect(exists).toBe(true);
  });

  describe('required sections', () => {
    let content: string;

    beforeAll(() => {
      content = fs.readFileSync(architecturePath, 'utf-8');
    });

    it('should have Component Overview section', () => {
      expect(content).toMatch(/##\s+Component Overview/i);
    });

    it('should have Data Flow section', () => {
      expect(content).toMatch(/##\s+Data Flow/i);
    });

    it('should have State Management section', () => {
      expect(content).toMatch(/##\s+State Management/i);
    });

    it('should have Adding Features section', () => {
      expect(content).toMatch(/##\s+Adding (New )?Features/i);
    });

    it('should have Wails Bindings section', () => {
      expect(content).toMatch(/##\s+Wails Bindings/i);
    });
  });
});
