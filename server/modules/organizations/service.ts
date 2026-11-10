import type { Actor } from "../../shared/types/contracts.js";
import type {
  OrganizationNode,
  OrganizationMovePreview,
} from "../../shared/types/trees.js";
import type { hierarchyRepository } from "../../database/repositories/hierarchies.js";
import type { Database } from "../../database/connection.js";
import type { DictionaryService } from "../dictionaries/service.js";
import { authorize, digest } from "../../platform/auth/service.js";
import {
  expectedVersion,
  requireValue,
  text,
} from "../../shared/errors/business-error.js";

export function createOrganizations(
  repository: ReturnType<typeof hierarchyRepository>,
  dictionaries: DictionaryService,
  database: Pick<Database, "transaction">,
) {
  function tree(actor: Actor) {
    authorize(actor, "read");
    return repository.organizations();
  }
  function path(nodes: OrganizationNode[], id: string | null): string[] {
    const index = new Map(nodes.map((node) => [node.id, node])),
      seen = new Set<string>(),
      names: string[] = [];
    let node = id ? index.get(id) : undefined;
    while (node) {
      requireValue(!seen.has(node.id), "组织层级存在循环");
      seen.add(node.id);
      names.unshift(node.name);
      node = node.parent_id ? index.get(node.parent_id) : undefined;
    }
    return names;
  }
  function preview(
    actor: Actor,
    id: string,
    parentId: string | null,
    nodes = repository.organizations(),
  ): OrganizationMovePreview {
    authorize(actor, "admin");
    const index = new Map(nodes.map((node) => [node.id, node]));
    const node = index.get(id);
    requireValue(node && !node.deleted, "单位不存在或已删除", 404);
    if (parentId) {
      const parent = index.get(parentId);
      requireValue(parent && parent.selectable, "请选择有效且未删除的上级单位");
      let current: OrganizationNode | undefined = parent;
      const visited = new Set<string>();
      while (current) {
        requireValue(
          current.id !== id && !visited.has(current.id),
          "不能选择自身或下级单位作为上级",
        );
        visited.add(current.id);
        current = current.parent_id ? index.get(current.parent_id) : undefined;
      }
    }
    requireValue(node.parent_id !== parentId, "组织上级没有变化");
    const children = new Map<string, string[]>();
    for (const child of nodes) {
      if (!child.parent_id) continue;
      const siblings = children.get(child.parent_id) || [];
      siblings.push(child.id);
      children.set(child.parent_id, siblings);
    }
    const descendants = new Set<string>([id]);
    const pending = [id];
    while (pending.length) {
      for (const childId of children.get(pending.pop()!) || []) {
        if (descendants.has(childId)) continue;
        descendants.add(childId);
        pending.push(childId);
      }
    }

    const result = {
      expected_version: node.version_no,
      parent_id: parentId,
      before_path: path(nodes, id).join(" / "),
      after_path: [...path(nodes, parentId), node.name].join(" / "),
      descendants: descendants.size - 1,
      projects: repository.organizationProjectCount([...descendants]),
    };
    return {
      ...result,
      preview_hash: digest(
        JSON.stringify({
          result,
          nodes: nodes
            .map((item) => [item.id, item.version_no, item.deleted])
            .sort(),
        }),
      ),
    };
  }
  return {
    tree,
    detail(actor: Actor, id: string) {
      authorize(actor, "read");
      requireValue(repository.organizationExists(id), "单位不存在", 404);
      return repository.organizationDetail(id);
    },
    preview,
    remove(actor: Actor, id: string, input: Record<string, unknown>) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const impact = repository.organizationDetail(id).references;
        requireValue(
          input.expected_children === undefined ||
            input.expected_children === impact.children,
          "直属下级已变化，请重新核对删除影响",
          409,
        );
        requireValue(
          input.expected_references === undefined ||
            input.expected_references === impact.historical_projects,
          "项目引用已变化，请重新核对删除影响",
          409,
        );
        return dictionaries.remove(
          actor,
          "organizations",
          id,
          input.expected_version,
        );
      });
    },
    move(actor: Actor, id: string, input: Record<string, unknown>) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const parentId =
          input.parent_id == null || input.parent_id === ""
            ? null
            : text(input.parent_id, "上级单位");
        const snapshot = repository.organizations();
        const existing = snapshot.find((node) => node.id === id);
        requireValue(existing && !existing.deleted, "单位不存在或已删除", 404);
        expectedVersion(existing.version_no, input.expected_version);
        const current = preview(actor, id, parentId, snapshot);
        requireValue(
          input.confirm_move === true &&
            current.preview_hash === input.preview_hash,
          "组织关系已变化，请重新预览并确认",
          409,
        );
        const node = existing;
        return dictionaries.saveOrganization(
          actor,
          {
            name: node.name,
            status: node.status,
            parent_unit_id: parentId,
            expected_version: node.version_no,
          },
          id,
        );
      });
    },
  };
}
