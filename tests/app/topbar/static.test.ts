import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { topbarStrings } from '@/app/components/topbar/strings';
import type { NumberFormatter } from '@/app/components/topbar/format';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const topbarDir = join(root, 'src/app/components/topbar');
const read = (path: string): string => readFileSync(path, 'utf8');
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const sourceFiles = readdirSync(topbarDir).filter((name) => /\.tsx?$/.test(name));
const sources = new Map(sourceFiles.map((name) => [name, read(join(topbarDir, name))]));
const css = stripComments(read(join(topbarDir, 'topbar.css')));
const theme = stripComments(read(join(root, 'src/app/styles/theme.css')));

const fmt: NumberFormatter = (value) => String(value);

function textOf(strings: object, key: string): string {
  const value: unknown = (strings as Record<string, unknown>)[key];
  if (typeof value !== 'string') throw new Error(`${key} is not a plain string`);
  return value;
}

describe('topbar strings', () => {
  const { ko, en } = topbarStrings;

  it('have the same keys, kinds and no empty text in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
    for (const key of Object.keys(ko)) {
      const koValue = (ko as Record<string, unknown>)[key];
      const enValue = (en as Record<string, unknown>)[key];
      expect(typeof enValue, key).toBe(typeof koValue);
      if (typeof koValue === 'string') {
        expect(koValue.trim(), key).not.toBe('');
        expect((enValue as string).trim(), key).not.toBe('');
      }
    }
  });

  it('the Korean texts are Korean and the English ones are not', () => {
    const hangul = /[가-힣]/;
    for (const key of ['download', 'clearAll', 'rangeHelp', 'titleRunning', 'keepOpen', 'hide']) {
      expect(hangul.test(textOf(ko, key)), `ko.${key}`).toBe(true);
      expect(hangul.test(textOf(en, key)), `en.${key}`).toBe(false);
    }
  });

  it('the texts the spec words exactly', () => {
    expect(en.clearAll).toBe('Clear all');
    expect(ko.clearAll).toBe('모두 해제');
    expect(en.selectedCount(3, fmt)).toBe('3 selected');
    expect(ko.selectedCount(3, fmt)).toBe('3개 선택됨');
    expect(en.download).toBe('Download');
    expect(ko.download).toBe('다운로드');
    expect(en.selectFirstTitle).toBe('Select channels first');
    expect(en.titleRunning).toBe('Exporting chats…');
    expect(en.keepOpen).toBe("Don't close this tab.");
    expect(en.creatingZip).toBe('Creating ZIP…');
    expect(en.stateSkipped).toBe('No access');
    expect(en.directMessages).toBe('Direct Messages');
    expect(en.rangeHelp).toBe('Leave empty to export everything.');
    expect(en.zipHelp).toBe('Files are zipped when more than one channel is selected.');
    expect(en.leaveDemo).toBe('Leave demo');
    expect(ko.leaveDemo).toBe('데모 종료');
    expect([en.languageLabel, en.languageAuto]).toEqual(['Language', 'Auto']);
    expect([ko.languageLabel, ko.languageAuto]).toEqual(['언어', '자동']);
    expect(en.languageHelp).toMatch(/exported files/);
    expect(ko.languageHelp).toMatch(/내보낸 파일/);
    expect(en.descHtml).toBe('Looks like Discord - best for reading (recommended)');
    expect(en.descTxt).toBe('Plain text');
    expect(en.descMd).toBe('For Notion / Obsidian / GitHub');
    expect(en.descXlsx).toBe('Excel - sort and filter');
    expect(en.descCsv).toBe('Spreadsheet / data analysis');
    expect(en.descJson).toBe('Full raw data for programs');
    expect(en.exportingProgress(3, 12, fmt)).toBe('Exporting… 3/12');
    expect(en.summaryDone(12, 48213, 'Discord Export 2026-10-06.zip', fmt)).toBe('12 channels, 48213 messages saved as Discord Export 2026-10-06.zip');
  });

  it('the functions produce sensible text for typical arguments', () => {
    for (const strings of [ko, en]) {
      expect(strings.removeFromSelection('general')).toContain('general');
      expect(strings.exportingProgress(1, 2, fmt)).toContain('1/2');
      expect(strings.channelsProgress(1, 2, fmt)).toContain('1');
      expect(strings.messageCount(5, fmt)).toContain('5');
      expect(strings.elapsed('01:02')).toContain('01:02');
      expect(strings.summaryDone(2, 3, 'a.zip', fmt)).toContain('a.zip');
      expect(strings.cancelledSummary(2, fmt)).toContain('2');
      expect(strings.cancelledSaved(2, 'a.zip', fmt)).toContain('a.zip');
      expect(strings.saveCompleted(4, fmt)).toContain('4');
      expect(strings.skippedHeading(3, fmt)).toContain('3');
      expect(strings.failedHeading(3, fmt)).toContain('3');
    }
  });

  it('the strings of the export scope: same shape in both languages, Korean is Korean, English is not', () => {
    const hangul = /[가-힣]/;
    for (const key of [
      'countLabel',
      'countAll',
      'countLimit',
      'limitInputLabel',
      'limitUnit',
      'quickPicks',
      'countPerChannel',
      'limitEmpty',
      'limitWhole',
      'resetToCommon',
      'settingsNeedAttention',
      'channelSettingsHint',
      'scopeAll',
    ]) {
      expect(hangul.test(textOf(ko, key)), `ko.${key}`).toBe(true);
      expect(hangul.test(textOf(en, key)), `en.${key}`).toBe(false);
    }
    expect(en.countLabel).toBe('Number of messages');
    expect(ko.countLabel).toBe('메시지 개수');
    expect([en.countAll, en.countLimit]).toEqual(['All', 'Limit to N']);
    expect([ko.countAll, ko.countLimit]).toEqual(['전체', '개수 지정']);
    expect(en.resetToCommon).toBe('Reset to common settings');
    expect(ko.resetToCommon).toBe('공통 설정으로 되돌리기');
    expect(en.channelSettings('general')).toBe('Export settings for general');
    expect(ko.channelSettings('general')).toBe('general 내보내기 설정');
  });

  it('the scope functions put their arguments into the text', () => {
    for (const strings of [ko, en]) {
      expect(strings.channelSettings('general')).toContain('general');
      expect(strings.ownSettingsCount(2, fmt)).toContain('2');
      expect(strings.ownSettingsNote(3, fmt)).toContain('3');
      expect(strings.limitRange(100000, fmt)).toContain('100000');
      for (const key of ['limitHelpNewest', 'limitHelpFrom', 'limitHelpWindow', 'limitHelpUntil'] as const) expect(strings[key](42, fmt), key).toContain('42');
      expect(strings.scopeNewest(42, fmt)).toContain('42');
      expect(strings.scopeFrom('2026-01-01')).toContain('2026-01-01');
      expect(strings.scopeFromLimit('2026-01-01', 42, fmt)).toMatch(/2026-01-01.*42/);
      expect(strings.scopeUntil('2026-02-02')).toContain('2026-02-02');
      expect(strings.scopeUntilLimit('2026-02-02', 42, fmt)).toMatch(/2026-02-02.*42|42.*2026-02-02/);
      expect(strings.scopeBetween('2026-01-01', '2026-02-02')).toMatch(/2026-01-01.*2026-02-02/);
      expect(strings.scopeBetweenLimit('2026-01-01', '2026-02-02', 42, fmt)).toMatch(/2026-01-01.*2026-02-02.*42/);
    }
  });

  it('the "use common settings" checkbox and its caption are gone from both languages (the panel opens straight on the editor)', () => {
    for (const strings of [ko, en]) {
      expect(Object.keys(strings)).not.toContain('useCommonSettings');
      expect(Object.keys(strings)).not.toContain('commonSettingsNow');
    }
    const panel = sources.get('ChannelScopePanel.tsx') ?? '';
    expect(panel).not.toMatch(/checkbox|useCommon|commonSettingsNow|topbar-scope__toggle/);
    expect(css).not.toMatch(/topbar-scope__toggle/);
  });

  it('English plurals', () => {
    expect(en.ownSettingsNote(1, fmt)).toBe('1 channel uses its own settings, so the date range and number above do not apply to it.');
    expect(en.ownSettingsNote(2, fmt)).toBe('2 channels use their own settings, so the date range and number above do not apply to them.');
    expect(en.scopeNewest(1, fmt)).toBe('Newest message');
    expect(en.scopeNewest(2, fmt)).toBe('Newest 2 messages');
    expect(en.limitHelpWindow(1, fmt)).toContain('first 1 message ');
    expect(en.messageCount(1, fmt)).toBe('1 message');
    expect(en.messageCount(2, fmt)).toBe('2 messages');
    expect(en.saveCompleted(1, fmt)).toBe('Save the 1 completed channel');
    expect(en.saveCompleted(2, fmt)).toBe('Save the 2 completed channels');
    expect(en.cancelledSummary(1, fmt)).toBe('1 channel was finished before you cancelled.');
    expect(en.cancelledSummary(3, fmt)).toBe('3 channels were finished before you cancelled.');
    expect(en.summaryDone(1, 1, 'x.txt', fmt)).toBe('1 channel, 1 message saved as x.txt');
    // QA-EXP-06: the note about unsaved channels agrees with the count.
    expect(en.unsavedNote(1)).toBe('It has not been saved yet. Closing without saving discards it.');
    expect(en.unsavedNote(2)).toBe('They have not been saved yet. Closing without saving discards them.');
    expect(ko.unsavedNote(1)).toBe(ko.unsavedNote(5));
  });

  it('the title of a run that exported nothing says so, in both languages (QA-EXP-07)', () => {
    expect(en.titleNothing).toBe('Nothing was exported');
    expect(ko.titleNothing).toBe('내보낸 채널이 없어요');
    for (const strings of [ko, en]) expect(strings.titleNothing).not.toBe(strings.titleDone);
  });
});

describe('topbar.css', () => {
  it('only uses colour tokens that exist in theme.css', () => {
    const defined = new Set([...theme.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
    const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(30);
    expect([...new Set(used)].filter((name) => !defined.has(name))).toEqual([]);
  });

  it('hard-codes no hex colour and no colour that exists as a token', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    // The only literals are the overlay tints of the spec: the 70% black backdrop, the black tint behind the format tag and the
    // white divider on the brand button.
    const literals = [...css.matchAll(/rgba?\([^)]*\)/g)].map((match) => match[0].replace(/\s+/g, ''));
    expect([...new Set(literals)].sort()).toEqual(['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.7)', 'rgba(255,255,255,0.25)']);
  });

  it('every class the components use is styled', () => {
    const used = new Set<string>();
    for (const [name, source] of sources) {
      if (!name.endsWith('.tsx')) continue;
      for (const match of source.matchAll(/['"`]((?:[\w-]+ )*topbar[\w-]*(?: [\w-]+)*)['"`]/g)) {
        for (const token of match[1].split(' ')) if (token.startsWith('topbar') && !token.endsWith('-')) used.add(token);
      }
    }
    expect(used.size).toBeGreaterThan(60);
    const missing = [...used].filter((token) => !new RegExp(`\\.${token}(?![\\w-])`).test(css));
    expect(missing).toEqual([]);
    // Built from a variable in RadioGroup.
    expect(css).toMatch(/\.topbar-radio--cards\b/);
    expect(css).toMatch(/\.topbar-radio--segmented\b/);
  });

  it('matches the visual spec of the bar, the chip, the split button and the popover', () => {
    // A rule whose selector is exactly `selector` (not one of a comma-separated group).
    const rule = (selector: string): string => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.topbar')).toMatch(/background:\s*var\(--bg-primary\)/);
    expect(rule('.topbar')).toMatch(/padding:\s*0 16px/);
    expect(rule('.topbar')).toMatch(/align-items:\s*center/);
    expect(rule('.topbar__actions')).toMatch(/gap:\s*12px/);
    expect(rule('.topbar__actions')).toMatch(/flex:\s*0 1 auto/);
    expect(rule('.topbar__name')).toMatch(/font-size:\s*16px/);
    expect(rule('.topbar__name')).toMatch(/font-weight:\s*600/);
    expect(rule('.topbar__name')).toMatch(/color:\s*var\(--text-header\)/);
    expect(rule('.topbar__icon')).toMatch(/font-size:\s*24px/);
    expect(rule('.topbar__icon')).toMatch(/color:\s*var\(--channel-icon\)/);
    expect(rule('.topbar__avatar')).toMatch(/width:\s*24px/);
    expect(rule('.topbar__divider')).toMatch(/width:\s*1px/);
    expect(rule('.topbar__divider')).toMatch(/height:\s*24px/);
    expect(rule('.topbar__topic')).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule('.topbar__topic')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.topbar__chip')).toMatch(/background:\s*var\(--bg-tertiary\)/);
    expect(rule('.topbar__chip')).toMatch(/font-size:\s*14px/);
    expect(rule('.topbar__chip')).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(rule('.topbar__split')).toMatch(/height:\s*32px/);
    expect(rule('.topbar__split')).toMatch(/background:\s*var\(--brand\)/);
    expect(rule('.topbar__split')).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(rule('.topbar__split')).toMatch(/font-size:\s*14px/);
    expect(rule('.topbar__split')).toMatch(/font-weight:\s*500/);
    expect(rule('.topbar__split-caret')).toMatch(/border-left:\s*1px solid rgba\(255, 255, 255, 0\.25\)/);
    expect(css).toMatch(/\.topbar__split-main:hover[^{]*\{[^}]*background:\s*var\(--brand-hover\)/);
    expect(rule('.topbar__split[data-unavailable]')).toMatch(/opacity:\s*0\.5/);
    expect(css).toMatch(/\.topbar__split\[data-unavailable\] \.topbar__split-main[^{]*\{[^}]*cursor:\s*not-allowed/);

    const popover = rule('.topbar-popover');
    expect(popover).toMatch(/background:\s*var\(--bg-secondary\)/);
    expect(popover).toMatch(/border:\s*1px solid var\(--divider\)/);
    expect(popover).toMatch(/box-shadow:\s*var\(--shadow-high\)/);
    expect(popover).toMatch(/z-index:\s*var\(--z-popover\)/);

    const dialog = rule('.topbar-dialog');
    expect(dialog).toMatch(/width:\s*560px/);
    expect(rule('.topbar-modal')).toMatch(/background:\s*rgba\(0, 0, 0, 0\.7\)/);
    expect(rule('.topbar-modal')).toMatch(/z-index:\s*var\(--z-modal\)/);
  });

  describe('narrow window', () => {
    // A rule whose selector is exactly `selector` (not one of a comma-separated group, not the one inside a @container block).
    const rule = (selector: string): string => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    const px = (name: string): number => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(theme)?.[1]);

    interface ContainerBlock {
      max: number;
      body: string;
    }

    /** The `@container topbar (max-width: Npx)` blocks with the CSS inside, widest first. */
    function containerBlocks(): ContainerBlock[] {
      const blocks: ContainerBlock[] = [];
      const opening = /@container topbar \(max-width:\s*(\d+)px\)\s*\{/g;
      for (let match = opening.exec(css); match !== null; match = opening.exec(css)) {
        let depth = 1;
        let index = opening.lastIndex;
        while (depth > 0 && index < css.length) {
          if (css[index] === '{') depth += 1;
          else if (css[index] === '}') depth -= 1;
          index += 1;
        }
        blocks.push({ max: Number(match[1]), body: css.slice(opening.lastIndex, index - 1) });
      }
      return blocks.sort((a, b) => b.max - a.max);
    }

    // The bar is as wide as the window minus the rail and the sidebar; its container is the content box inside the 16px padding.
    const narrowestBar = px('min-app-width') - px('rail-width') - px('sidebar-width') - 2 * 16;

    it('the bar is the size container the breakpoints measure', () => {
      expect(rule('.topbar')).toMatch(/container:\s*topbar\s*\/\s*inline-size/);
      expect(narrowestBar).toBe(556);
    });

    it('the title keeps a readable minimum and takes what the actions leave over', () => {
      const title = rule('.topbar__title');
      expect(Number(/min-width:\s*(\d+)px/.exec(title)?.[1])).toBeGreaterThanOrEqual(160);
      expect(title).toMatch(/flex:\s*1 1 0/);
    });

    it('the actions can shrink (otherwise the title absorbs the whole squeeze) and the account label gives way first', () => {
      expect(rule('.topbar__actions')).toMatch(/flex:\s*0 1 auto/);
      expect(rule('.topbar__actions')).toMatch(/min-width:\s*0\b/);
      expect(rule('.topbar__account')).toMatch(/flex:\s*0 1 auto/);
      expect(rule('.topbar__account')).toMatch(/min-width:\s*0\b/);
      expect(rule('.topbar__account-text')).toMatch(/text-overflow:\s*ellipsis/);
      expect(rule('.topbar__account-text')).toMatch(/min-width:\s*0\b/);
      // The chip and the button keep their size: they collapse by breakpoint, they are not squeezed.
      expect(rule('.topbar__chip')).toMatch(/flex:\s*none/);
      expect(rule('.topbar__split')).toMatch(/flex:\s*none/);
    });

    it('collapses in this order: the connected-as text, then the chip text, then the format tag', () => {
      const blocks = containerBlocks();
      expect(blocks).toHaveLength(3);
      expect(new Set(blocks.map((block) => block.max)).size).toBe(3);
      const [account, chip, format] = blocks;
      expect(account.body).toMatch(/\.topbar__account-text\b/);
      expect(chip.body).toMatch(/\.topbar__chip-rest\b/);
      expect(format.body).toMatch(/\.topbar__format-chip\b/);
      // Each step only touches its own part.
      expect(account.body).not.toMatch(/chip|format/);
      expect(format.body).not.toMatch(/account|chip-rest/);
    });

    it('never hides the DEMO pill / "Leave demo" button, the icon and number of the chip or the download button itself', () => {
      for (const { body } of containerBlocks()) {
        expect(body).not.toMatch(/\.topbar__demo|\.topbar__chip-count|\.topbar__chip-icon|\.topbar__split/);
      }
    });

    it('hidden parts stay in the accessibility tree: clipped, never display: none', () => {
      for (const { body } of containerBlocks()) {
        const hiding = body.match(/\.topbar__(?:account-text|chip-rest|format-chip)\s*\{[^}]*\}/g) ?? [];
        expect(hiding.length).toBeGreaterThan(0);
        for (const declaration of hiding) {
          expect(declaration).toMatch(/position:\s*absolute/);
          expect(declaration).toMatch(/clip-path:\s*inset\(50%\)/);
          expect(declaration).not.toMatch(/display:\s*none|visibility:\s*hidden/);
        }
      }
    });

    it('the steps reach the supported minimum window, and the first one comes well before it', () => {
      const blocks = containerBlocks();
      // At the narrowest supported window every step is active ...
      expect(blocks[blocks.length - 1].max).toBeGreaterThanOrEqual(narrowestBar);
      // ... while the first one only starts on a bar clearly wider than that.
      expect(blocks[0].max).toBeGreaterThan(narrowestBar + 100);
    });

    it('the focus guards of the popovers are invisible and out of the layout', () => {
      const guard = rule('.topbar-focus-guard');
      expect(guard).toMatch(/position:\s*absolute/);
      expect(guard).toMatch(/opacity:\s*0/);
    });
  });

  it('respects reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/animation:\s*none/);
    // Every control that fades has its fade switched off there.
    const withTransition = [...css.matchAll(/([^{}]+)\{[^}]*\btransition\b[^}]*\}/g)]
      .map((match) => match[1].trim())
      .filter((selector) => selector.startsWith('.topbar-count__chip') || selector.startsWith('.topbar__chip'));
    expect(withTransition.length).toBeGreaterThan(1);
    expect(block).toMatch(/\.topbar-count__chip\s*[,{]/);
    expect(block).toMatch(/\.topbar__chip\s*[,{]/);
  });

  describe('the gear, the settings panel and the count', () => {
    const rule = (selector: string): string => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('the gear is the same 24px button as the x, with the same hover', () => {
      expect(css).toMatch(/\.topbar-sel__gear,\s*\.topbar-sel__remove\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/);
      expect(css).toMatch(/\.topbar-sel__gear:hover,\s*\.topbar-sel__remove:hover\s*\{[^}]*var\(--interactive-hover\)/);
    });

    it('a gear with own settings is brand coloured and carries a dot; a gear with a problem is red', () => {
      expect(css).toMatch(/\.topbar-sel__gear\[data-active\][^{]*\{[^}]*color:\s*var\(--brand\)/);
      expect(css).toMatch(/\.topbar-sel__gear\[data-active\]::after[^{]*\{[^}]*content:/);
      expect(css).toMatch(/\.topbar-sel__gear\[data-invalid\][^{]*\{[^}]*color:\s*var\(--text-danger\)/);
      expect(rule('.topbar-sel__gear[data-invalid]::after')).toMatch(/background:\s*var\(--danger\)/);
      expect(rule('.topbar__chip-dot')).toMatch(/background:\s*var\(--brand\)/);
      expect(rule('.topbar__chip')).toMatch(/position:\s*relative/);
    });

    it('the row summary lines up with the name and is cut off instead of wrapping', () => {
      const summary = rule('.topbar-sel__scope');
      expect(summary).toMatch(/text-overflow:\s*ellipsis/);
      expect(summary).toMatch(/white-space:\s*nowrap/);
      expect(summary).toMatch(/font-size:\s*12px/);
      expect(rule('.topbar-sel__scope[data-invalid]')).toMatch(/color:\s*var\(--text-danger\)/);
    });

    it('the unfolded settings are a bordered card inside the scrolling list, and the popovers scroll', () => {
      expect(rule('.topbar-scope')).toMatch(/border:\s*1px solid var\(--divider\)/);
      expect(rule('.topbar-sel__groups')).toMatch(/overflow-y:\s*auto/);
      expect(rule('.topbar-options')).toMatch(/overflow-y:\s*auto/);
    });

    it('the count input and its chips are styled like the date inputs, a pressed chip is brand coloured', () => {
      expect(rule('.topbar-count__input')).toMatch(/background:\s*var\(--bg-input\)/);
      expect(rule(".topbar-count__input[aria-invalid='true']")).toMatch(/border-color:\s*var\(--danger\)/);
      expect(rule(".topbar-count__chip[aria-pressed='true']")).toMatch(/background:\s*var\(--brand\)/);
      expect(rule('.topbar-count__chips')).toMatch(/flex-wrap:\s*wrap/);
    });
  });
});

describe('topbar sources', () => {
  it('never inject HTML', () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/);
    }
  });

  it('use no `any` and no leftover TODO / debugging', () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
      expect(source, name).not.toMatch(/TODO|FIXME|console\.(log|debug)/);
    }
  });

  it('do not depend on the lazy format registry (EXPORT_FORMAT_META lives next to the loaders; the picker owns its own labels)', () => {
    for (const [name, source] of sources) expect(source, name).not.toMatch(/lib\/export\/formats'/);
  });

  it('TopBar keeps the contract: named export, no props, root class app-topbar', () => {
    const topBar = sources.get('TopBar.tsx') ?? '';
    expect(topBar).toMatch(/export function TopBar\(\)/);
    expect(topBar).toMatch(/className="app-topbar topbar"/);
    expect(topBar).toMatch(/import '\.\/topbar\.css'/);
  });

  it('the gear icon is decorative: the button carries the name', () => {
    const gearIcon = sources.get('GearIcon.tsx') ?? '';
    expect(gearIcon).toMatch(/aria-hidden="true"/);
    expect(gearIcon).not.toMatch(/<title>/);
    expect(sources.get('SelectionRow.tsx')).toMatch(/aria-label=\{t\.channelSettings\(channelName\)\}/);
  });

  it('every image URL comes from the model (SafeImg with a fallback), never from a literal or a message', () => {
    const imgTags = [...sources.values()].flatMap((source) => [...source.matchAll(/<img\b/g)]);
    expect(imgTags).toHaveLength(0);
    expect(sources.get('ChannelTitle.tsx')).toMatch(/<SafeImg[^>]*src=\{dm\.iconUrl\}[^>]*fallback=\{fallback\}/);
  });
});

describe('contrast (WCAG 2.1 AA, 4.5:1 for text under 18px)', () => {
  type Rgb = [number, number, number];
  type Rgba = [number, number, number, number];

  const tokens = new Map([...theme.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [match[1], match[2].trim()] as const));
  const commonCss = stripComments(read(join(root, 'src/app/components/common/common.css')));

  /** The declarations of every rule whose selector list contains exactly `selector`; later rules win, as in the cascade for equal specificity. */
  function declarationsOf(source: string, selector: string): Map<string, string> {
    const merged = new Map<string, string>();
    for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!block[1].split(',').some((candidate) => candidate.trim().replace(/\s+/g, ' ') === selector)) continue;
      for (const declaration of block[2].matchAll(/([a-z-]+)\s*:\s*([^;]+);?/g)) merged.set(declaration[1], declaration[2].trim());
    }
    return merged;
  }

  function color(value: string): Rgba {
    const text = value.trim();
    const variable = /^var\((--[a-z0-9-]+)\)$/.exec(text);
    if (variable !== null) return color(tokens.get(variable[1]) ?? '');
    if (text === 'white') return [255, 255, 255, 1];
    if (text === 'black') return [0, 0, 0, 1];
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
    if (hex !== null) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), 1];
    const rgba = /^rgba?\(([^)]+)\)$/.exec(text);
    if (rgba !== null) {
      const [r, g, b, a = '1'] = rgba[1].split(',').map((part) => part.trim());
      return [Number(r), Number(g), Number(b), Number(a)];
    }
    const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(\w+)\)$/.exec(text);
    if (mix !== null) {
      const [first, second, share] = [color(mix[1]), color(mix[3]), Number(mix[2]) / 100];
      return [first[0] * share + second[0] * (1 - share), first[1] * share + second[1] * (1 - share), first[2] * share + second[2] * (1 - share), 1];
    }
    throw new Error(`cannot read the colour "${value}"`);
  }

  const over = (top: Rgba, below: Rgb): Rgb => [0, 1, 2].map((i) => top[i] * top[3] + below[i] * (1 - top[3])) as Rgb;
  const luminance = ([r, g, b]: Rgb): number => {
    const channel = (value: number): number => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: Rgb, b: Rgb): number => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const rgb = (value: string, below: Rgb = [0, 0, 0]): Rgb => over(color(value), below);

  /** The declared value of `property` on the first selector that sets it: the more specific selectors first, the plain one last. */
  function effective(property: string, ...selectors: string[]): string {
    for (const selector of selectors) {
      const value = declarationsOf(css, selector).get(property) ?? declarationsOf(commonCss, selector).get(property);
      if (value !== undefined) return value;
    }
    throw new Error(`no ${property} on ${selectors.join(' / ')}`);
  }

  it('the ratio maths is right (white on the shared red is the 3.77:1 of the QA report, white on the brand blue 4.61:1)', () => {
    expect(ratio([255, 255, 255], rgb('var(--danger)'))).toBeCloseTo(3.77, 2);
    expect(ratio([255, 255, 255], rgb('var(--brand)'))).toBeCloseTo(4.61, 2);
  });

  it('the red Cancel button of the dialog: white text on its fill, at rest and on hover (QA-LAYOUT-04)', () => {
    const text = rgb(effective('color', '.dce-button'));
    const rest = rgb(effective('background', '.topbar-dialog__footer .dce-button--danger', '.dce-button--danger'));
    const hover = rgb(effective('background', '.topbar-dialog__footer .dce-button--danger:hover:not(:disabled)', '.dce-button--danger:hover:not(:disabled)'));
    expect(ratio(text, rest)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(text, hover)).toBeGreaterThanOrEqual(4.5);
    // Hovering still changes something.
    expect(hover).not.toEqual(rest);
  });

  describe('format cards (QA-LAYOUT-05)', () => {
    const popover = rgb(effective('background', '.topbar-popover'));
    const hoverTint = effective('background', '.topbar-radio--cards .topbar-radio__option:hover');
    const selectedTint = effective('background', ".topbar-radio--cards .topbar-radio__option[aria-checked='true']");
    const description = (state: string): string =>
      effective('color', `.topbar-radio--cards .topbar-radio__option${state} .topbar-radio__description`, '.topbar-radio__description');

    it.each([
      ['at rest', '', null],
      ['on hover', ':hover', hoverTint],
      ['when selected', "[aria-checked='true']", selectedTint],
    ])('the description is readable %s', (_state, selector, tint) => {
      const background = tint === null ? popover : rgb(tint, popover);
      expect(ratio(rgb(description(selector)), background)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('the selected segment of a segmented choice: its label is white on the brand blue (QA-LAYOUT-05)', () => {
    const selected = ".topbar-radio--segmented .topbar-radio__option[aria-checked='true']";
    const background = rgb(effective('background', selected));
    const label = rgb(effective('color', `${selected} .topbar-radio__label`, '.topbar-radio__label'));
    expect(ratio(label, background)).toBeGreaterThanOrEqual(4.5);
    // The unselected ones were never a problem: they sit on the dark track.
    const track = rgb(effective('background', '.topbar-radio--segmented'));
    expect(ratio(rgb(effective('color', '.topbar-radio__label')), track)).toBeGreaterThanOrEqual(4.5);
  });

  it('the format tag inside the Download button: white on its tint over the fill, at rest, on hover and pressed (V-LAYOUT-03)', () => {
    const tag = effective('background', '.topbar__format-chip');
    const text = rgb(effective('color', '.topbar__format-chip', '.topbar__split'));
    const fills = {
      'at rest': effective('background', '.topbar__split-main'),
      'on hover': effective('background', '.topbar__split:not([data-unavailable]) .topbar__split-main:hover'),
      pressed: effective('background', '.topbar__split:not([data-unavailable]) .topbar__split-main:active'),
    };
    for (const [state, fill] of Object.entries(fills)) {
      expect(ratio(text, rgb(tag, rgb(fill))), state).toBeGreaterThanOrEqual(4.5);
    }
  });

  describe('hover states of the text buttons of the popovers (V-LAYOUT-04)', () => {
    /** What the button sits on while hovered: its surface, with the hover tint over it when the hover rule paints one. */
    function hovered(selector: string, surface: string): { text: Rgb; background: Rgb } {
      const base = rgb(surface);
      const tint = declarationsOf(css, `${selector}:hover`).get('background');
      return { text: rgb(effective('color', `${selector}:hover`, selector)), background: tint === undefined ? base : rgb(tint, base) };
    }

    it.each([
      ['Reset to common settings', '.topbar-scope__reset', '.topbar-scope'],
      ['Clear all', '.topbar-sel__clear', '.topbar-popover'],
    ])('%s is at least 4.5:1 at rest and on hover, and hovering still shows something', (_name, selector, surface) => {
      const surfaceColour = effective('background', surface);
      const rest = { text: rgb(effective('color', selector)), background: rgb(surfaceColour) };
      const hover = hovered(selector, surfaceColour);
      expect(ratio(rest.text, rest.background)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hover.text, hover.background)).toBeGreaterThanOrEqual(4.5);
      expect(declarationsOf(css, `${selector}:hover`).get('text-decoration')).toBe('underline');
    });
  });

  it('the state word of a channel that failed is the lighter red, on the list surface (V-LAYOUT-05)', () => {
    const row = ".topbar-targets__row[data-status='error']";
    const word = rgb(effective('color', `${row} .topbar-targets__state`, '.topbar-targets__state'));
    const surface = rgb(effective('background', '.topbar-targets'));
    expect(ratio(word, surface)).toBeGreaterThanOrEqual(4.5);
    // The icon next to it is not text: it keeps the saturated --danger of the other error markers.
    expect(effective('color', `${row} .topbar-targets__icon`)).toBe('var(--danger)');
  });

  it('the parent of a thread keeps its width when the thread name is long (QA-LAYOUT-08)', () => {
    const parent = declarationsOf(css, '.topbar__name--parent');
    expect(parent.get('flex-shrink')).toBe('0');
    expect(parent.get('max-width')).toBe('40%');
    // The name itself is what gives way, down to the ellipsis.
    expect(declarationsOf(css, '.topbar__name').get('min-width')).toBe('0');
  });
});
