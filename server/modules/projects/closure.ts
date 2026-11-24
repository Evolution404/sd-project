import type { projectClosureRepository } from "../../database/repositories/project-closure.js";
import { authorize, digest, id, now } from "../../platform/auth/service.js";
import { authorizeProject } from "../../platform/auth/project-access.js";
import { expectedVersion, requireValue } from "../../shared/errors/business-error.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { createFinance } from "../finance/service.js";
import type { ProjectService } from "./service.js";

export function createProjectClosure(
  repo: ReturnType<typeof projectClosureRepository>,
  projects: Pick<ProjectService, "workspace" | "get">,
  finance: Pick<ReturnType<typeof createFinance>, "summary">,
) {
  function closeBlockReason(projectId: string): string {
    const unfinished = repo.unfinishedSettlements(projectId);
    const labels: Record<string, string> = { draft: "尚有未提交的结算草稿或修订草稿", submit: "结算待审核", return: "结算已退回待处理" };
    const settlements = Object.entries(labels).flatMap(([status, label]) => {
      const records = unfinished.filter(row => row.status === status);
      return records.length ? [label + "：" + records.map(row => row.number).join("、")] : [];
    });
    return [...settlements, ...repo.closeApprovalBlockers(projectId)].join("。");
  }
  function closePreview(actor: Actor, key: string) {
    authorize(actor, "project.close");
    const project = projects.workspace(key);
    authorizeProject(actor, "project.close", project);
    requireValue(project.status === "approved" && project.approval, "仅已批准项目可以审核结项", 409);
    const snapshot = { ...finance.summary(key), locations: repo.closureLocations(key) };
    const releases = repo.closeReleases(key);
    const reason = closeBlockReason(key);
    return {
      expected_version: project.version,
      approval_version: project.approval.version_no,
      summary: snapshot,
      release_demands: releases,
      reason,
      preview_hash: digest(JSON.stringify([
        actor.id, key, project.version, project.approval.id, snapshot, reason, repo.closeFinanceVersions(key),
      ])),
    };
  }
  return {
    blockReason: closeBlockReason,
    settlementBlockers: repo.unfinishedSettlements,
    preview: closePreview,
    commit(actor: Actor, key: string, input: {expected_version:number;preview_hash:string;reason?:string}) {
      authorize(actor, "project.close");
      return repo.transaction(() => {
        const project = projects.get(key);
        authorizeProject(actor, "project.close", project);
        expectedVersion(project.version, input.expected_version);
        requireValue(project.approval, "缺少批准版本");
        const preview = closePreview(actor, key);
        requireValue(!preview.reason, preview.reason, 409);
        requireValue(preview.preview_hash === input.preview_hash,
          "结项核对内容已变化，请重新读取并确认", 409);
        repo.createClosure({
          id: id(),
          project_id: key,
          approval_version_id: project.approval.id,
          reason: input.reason || "",
          close_snapshot_json: JSON.stringify(preview.summary),
          closed_by: actor.id,
          closed_at: now(),
        });
        repo.appendStage({
          id: id(),
          project_id: key,
          stage: "closed",
          project_version: project.version + 1,
          actor_id: actor.id,
          created_at: now(),
          reason: input.reason || "",
        });
        // Ownership release is an immutable link event, never deletion of the
        // project's frozen approval, settlement or audit history.
        for (const released of preview.release_demands) {
          repo.appendDemandLink({
            id: id(), project_scope_id: released.project_scope_id,
            event_seq: released.event_seq + 1, action: "released",
            actor_id: actor.id, recorded_at: now(),
            reason: input.reason || "项目正式结项，释放需求剩余工作量",
          });
        }
        return projects.get(key);
      });
    },
  };
}
