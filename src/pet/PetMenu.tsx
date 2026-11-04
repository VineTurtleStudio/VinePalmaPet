import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

interface PetMenuProps {
  stateName: string;
  scaleLabel: string;
  alwaysOnTop: boolean;
  onPat: () => void;
  onFocus: () => void;
  onSleep: () => void;
  onTalk: () => void;
  onScaleDown: () => void;
  onScaleUp: () => void;
  onToggleTop: () => void;
  onReset: () => void;
  onQuit: () => void;
}

const STATE_LABEL: Record<string, string> = {
  idle: "待机",
  pat: "开心",
  celebrate: "庆祝",
  focus: "专注",
  sleep: "睡觉",
  talk: "说话",
};

export function PetMenu(props: PetMenuProps) {
  const stop = (event: ReactPointerEvent | ReactMouseEvent) => event.stopPropagation();

  return (
    <div
      className="pet-menu"
      onPointerDown={stop}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="pet-menu__title">
        <span>VinePalmaPet</span>
        <span className="pet-menu__state">{STATE_LABEL[props.stateName] ?? props.stateName}</span>
      </div>

      <button type="button" onClick={props.onPat}>
        摸摸头
      </button>
      <button type="button" onClick={props.onFocus}>
        {props.stateName === "focus" ? "结束专注" : "专注模式"}
      </button>
      <button type="button" onClick={props.onSleep}>
        睡一会儿
      </button>
      <button type="button" onClick={props.onTalk}>
        说句话
      </button>

      <div className="pet-menu__row">
        <span>大小</span>
        <button type="button" onClick={props.onScaleDown} aria-label="缩小">
          −
        </button>
        <span className="pet-menu__value">{props.scaleLabel}</span>
        <button type="button" onClick={props.onScaleUp} aria-label="放大">
          +
        </button>
      </div>

      <button type="button" onClick={props.onToggleTop}>
        <span className="pet-menu__check">{props.alwaysOnTop ? "✓" : ""}</span> 窗口置顶
      </button>
      <button type="button" onClick={props.onReset}>
        回到默认位置
      </button>

      <div className="pet-menu__sep" />
      <button type="button" className="danger" onClick={props.onQuit}>
        退出
      </button>
    </div>
  );
}
