import { authorize, id, now } from "../../platform/auth/service.js";
import { requireValue, text } from "../../shared/errors/business-error.js";
const editable = ["description", "discovered_on", "proposed_by"];
export function currentSources(repo, demandId, includeHistorical = false) {
  return repo.demandSources(demandId, includeHistorical);
}
export function reviseSource(repo, catalog, actor, key, input) {
  authorize(actor, "write");
  const original = repo.find("source_records", "id", key);
  requireValue(original, "来源不存在", 404);
  requireValue(
    !repo
      .auditFor("sources", key)
      .some((event) => ["delete", "correct"].includes(event.action)),
    "该来源已删除或已有更正版，请刷新",
    409,
  );
  const changed = editable.some(
    (field) => input[field] !== undefined && input[field] !== original[field],
  );
  if (!changed) return original;
  const replacement = {
    ...original,
    id: id(),
    created_by: actor.id,
    created_at: now(),
  };
  for (const field of editable)
    if (input[field] !== undefined) replacement[field] = input[field];
  replacement.description = text(replacement.description, "来源说明");
  repo.insert("source_records", replacement);
  for (const link of repo.where("demand_sources", { source_id: key }))
    repo.insert("demand_sources", {
      demand_id: link.demand_id,
      source_id: replacement.id,
    });
  catalog.audit(actor, "sources", key, "correct", original, {
    replacement_source_id: replacement.id,
  });
  return replacement;
}
export function createSources(repo, catalog) {
  return {
    revise(actor, key, input) {
      return repo.transaction(() =>
        reviseSource(repo, catalog, actor, key, input),
      );
    },
    remove(actor, key) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const original = repo.find("source_records", "id", key);
        requireValue(original, "来源不存在", 404);
        requireValue(
          !repo
            .auditFor("sources", key)
            .some((event) => ["delete", "correct"].includes(event.action)),
          "该来源已有后续处理，请刷新",
          409,
        );
        catalog.audit(actor, "sources", key, "delete", original, {
          logical: true,
        });
        return { deleted: true };
      });
    },
    history(key) {
      const original = repo.find("source_records", "id", key);
      requireValue(original, "来源不存在", 404);
      return { original, decisions: repo.auditFor("sources", key) };
    },
  };
}
