export function projectStatusTag(status: string): "success" | "info" | "warning" | undefined {
  switch (status) {
    case "已批准": return "success";
    case "已结项": return "info";
    case "立项中":
    case "变更中": return "warning";
    default: return undefined;
  }
}
