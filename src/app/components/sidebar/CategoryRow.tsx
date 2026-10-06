import { memo, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore, useCategoryCheck } from '@/app/state';
import type { CategoryNode } from '@/lib/discord/model';
import type { Snowflake } from '@/lib/discord/types';
import { Checkbox } from '../common/Checkbox';
import { ChevronDown } from '../common/Icons';
import { sidebarStrings } from './strings';

export interface CategoryRowProps {
  guildId: Snowflake;
  category: CategoryNode;
  collapsed: boolean;
  /** False when nothing below it can be exported: the checkbox is left out. */
  selectable: boolean;
}

/** Category header: click folds it, the checkbox on the right (shown on hover / when ticked) selects everything in it. */
export const CategoryRow = memo(function CategoryRow({ guildId, category, collapsed, selectable }: CategoryRowProps): ReactElement {
  const t = useStrings(sidebarStrings);
  const toggleCollapsed = useAppStore((state) => state.toggleCategoryCollapsed);
  const toggleCategory = useAppStore((state) => state.toggleCategory);
  const check = useCategoryCheck(guildId, category.id);

  return (
    <li className={collapsed ? 'sb-category sb-category--collapsed dce-reveal-host' : 'sb-category dce-reveal-host'} data-sb-row="">
      <button
        type="button"
        className="sb-category__main"
        data-sb-nav=""
        aria-expanded={!collapsed}
        title={category.name}
        onClick={() => toggleCollapsed(category.id)}
      >
        <ChevronDown className="sb-category__chevron" />
        <span className="sb-category__name">{category.name}</span>
      </button>
      {selectable ? (
        <Checkbox
          className="sb-category__check"
          size={16}
          state={check}
          ariaLabel={t.selectCategory(category.name)}
          revealOnHover
          onChange={() => toggleCategory(guildId, category.id)}
        />
      ) : null}
    </li>
  );
});
