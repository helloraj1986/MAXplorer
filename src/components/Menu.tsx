import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface MenuItem {
  type?: "item" | "separator";
  label?: string;
  icon?: IconName;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  bold?: boolean;
  submenu?: MenuItem[];
  onClick?: () => void;
}

export interface MenuPanelProps {
  items: MenuItem[];
  width?: number;
  itemHeight?: number;
  showIcons?: boolean;
  className?: string;
  style?: CSSProperties;
  onClose: () => void;
  footer?: ReactNode;
}

function isSeparator(item: MenuItem): boolean {
  return item.type === "separator" || item.label === "-";
}

export function MenuPanel({
  items,
  width = 220,
  itemHeight = 30,
  showIcons = true,
  className,
  style,
  onClose,
  footer,
}: MenuPanelProps) {
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const [flipSubmenu, setFlipSubmenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (openSubmenu == null || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    setFlipSubmenu(bounds.right + 230 > window.innerWidth - 8);
  }, [openSubmenu]);

  useEffect(() => {
    setOpenSubmenu(null);
  }, [items]);

  const activate = (item: MenuItem, index: number) => {
    if (item.disabled) return;
    if (item.submenu?.length) {
      setOpenSubmenu((current) => (current === index ? null : index));
      return;
    }
    item.onClick?.();
    onClose();
  };

  return (
    <div
      ref={ref}
      className={`menu-panel ${showIcons ? "with-icons" : ""} ${className ?? ""}`}
      style={{ width, ...style }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (isSeparator(item)) {
          return <div className="menu-separator" role="separator" key={`sep-${index}`} />;
        }
        const hasSubmenu = Boolean(item.submenu?.length);
        const active = openSubmenu === index;
        return (
          <div
            key={`${item.label}-${index}`}
            className="menu-item-wrap"
            onMouseEnter={() => setOpenSubmenu(hasSubmenu ? index : null)}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup={hasSubmenu ? "menu" : undefined}
              aria-disabled={item.disabled || undefined}
              className={`menu-item ${item.disabled ? "disabled" : ""} ${item.danger ? "danger" : ""} ${item.bold ? "bold" : ""} ${active ? "active" : ""}`}
              style={{ minHeight: itemHeight }}
              onClick={() => activate(item, index)}
              onMouseDown={(event) => event.preventDefault()}
            >
              <span className="menu-check" aria-hidden="true">
                {item.checked ? <span className="menu-check-dot" /> : null}
              </span>
              {showIcons ? (
                <span className="menu-icon" aria-hidden="true">
                  {item.icon ? <Icon name={item.icon} size={16} /> : null}
                </span>
              ) : null}
              <span className="menu-label">{item.label}</span>
              {item.shortcut ? <span className="menu-shortcut">{item.shortcut}</span> : null}
              {hasSubmenu ? (
                <span className="menu-chevron" aria-hidden="true">
                  <Icon name="chevronRight" size={12} />
                </span>
              ) : null}
            </button>
            {hasSubmenu && active ? (
              <div
                ref={submenuRef}
                className={`menu-submenu ${flipSubmenu ? "flip" : ""}`}
                style={{ top: -5 }}
              >
                <MenuPanel
                  items={item.submenu ?? []}
                  width={Math.max(width, 176)}
                  itemHeight={itemHeight}
                  showIcons={showIcons}
                  onClose={onClose}
                />
              </div>
            ) : null}
          </div>
        );
      })}
      {footer ? <div className="menu-footer">{footer}</div> : null}
    </div>
  );
}
