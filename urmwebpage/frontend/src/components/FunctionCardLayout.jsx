function joinClassNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function FunctionCard({ as: Tag = "section", className = "", children, ...props }) {
  return (
    <Tag className={joinClassNames("runner-toolbar-shell", "function-card", className)} {...props}>
      {children}
    </Tag>
  );
}

export function FunctionCardRows({ className = "", children, ...props }) {
  return (
    <div className={joinClassNames("function-card-rows", className)} {...props}>
      {children}
    </div>
  );
}

export function FunctionCardRow({ className = "", children, ...props }) {
  return (
    <div className={joinClassNames("function-card-row", className)} {...props}>
      {children}
    </div>
  );
}

export function FunctionCardLabel({ as: Tag = "div", className = "", children, ...props }) {
  return (
    <Tag className={joinClassNames("function-card-label", className)} {...props}>
      {children}
    </Tag>
  );
}

export function FunctionCardMath({ as: Tag = "div", className = "", children, ...props }) {
  return (
    <Tag className={joinClassNames("function-card-math", className)} {...props}>
      {children}
    </Tag>
  );
}

export function FunctionCardControls({ as: Tag = "div", className = "", children, ...props }) {
  return (
    <Tag className={joinClassNames("function-card-controls", className)} {...props}>
      {children}
    </Tag>
  );
}
