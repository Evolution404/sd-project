import type { HistoryQuery } from "../../shared/types/history.js";
import type { HandlingTarget, HandlingReviewRow } from "../../shared/types/handling-batch.js";
import type { ProjectApprovalScopeInput, ProjectApprovalCandidateProposal, ProjectScopeListItem } from "../../shared/types/projects.js";
import { ordinaryLinkReason, approvalDraftReason, projectDeleteReason } from "../../shared/project-lifecycle.js";
import { authorize, id, now, today } from "../../platform/auth/service.js";
import {
  BusinessError,
  requireValue,
  expectedVersion,
  text,
  integer,
} from "../../shared/errors/business-error.js";
import { assertQuantityPrecision } from "../../shared/quantity-precision.js";
import { projectDisplayStatus } from "../../shared/project-display-status.js";
import type { Actor, ListQuery } from "../../shared/types/contracts.js";
import type { CatalogService } from "../catalog/service.js";
import type { DemandService } from "../../shared/types/demands.js";
import type { PricingService } from "../pricing/service.js";
import type { FundingService } from "../funding/service.js";
import type { ProjectPersistenceRepository } from "../../database/repositories/project-persistence.js";
import type { QuantityUnitRepository } from "../../database/repositories/quantity-units.js";
import type { ProjectManagementInput, ProjectFromDemandInput,
  ProjectApprovalVersion, ProjectFundingVersion, ProjectApprovalInput, ProjectLinkInput, ProjectLinkBatchInput, ProjectReleaseInput,
  ProjectVersionAction, ProjectFundingInput } from "../../shared/types/projects.js";

export function createProjects(
  repo: ProjectPersistenceRepository,
  catalog: CatalogService,
  demands: DemandService,
  pricing: PricingService,
  quantityUnits: QuantityUnitRepository,
  funding: FundingService,
) {
  function get(key: string, includeDeleted = false, currentOnly = false) {
    const root = repo.projectIdentity(key);
    requireValue(
      root && (includeDeleted || !repo.projectDeleted(key)),
      "项目不存在或已删除",
      404,
    );
    const profile = repo.latestProjectProfile(key),
      approval =
        repo.latestApprovedProject(key) || null;
    requireValue(profile, "项目档案版本不存在", 404);
    const scopes = repo.projectScopes(key);
    const approvalRows = repo.projectApprovalHistory(key, currentOnly);
    return {
      ...profile,
      ...root,
      display_status: projectDisplayStatus(root.status, approvalRows),
      deleted: repo.projectDeleted(key),
      category_name: profile.category_id
        ? repo.categoryVersionName(profile.category_id, profile.category_version ?? 0)
        : null,
      managing_unit_name: profile.managing_unit_version_id
        ? repo.projectOrganizationVersion(profile.managing_unit_version_id)?.name
        : null,
      owner_username: profile.owner_id
        ? repo.projectAccount(profile.owner_id)?.username
        : null,
      manager_username: profile.manager_id
        ? repo.projectAccount(profile.manager_id)?.username
        : null,
      profile_version: profile.version_no,
      funding:
        repo.latestProjectFunding(key) || null,
      approval,
      scopes,
      approvals: (() => {
        const summaries = currentOnly
          ? pricing.summariesForApprovals(approvalRows.map(ap => ap.id))
          : pricing.projectSummaries(key, approvalRows.map(ap => ap.id));
        return approvalRows.map(ap => {
          const reference = summaries.get(ap.id);
          requireValue(reference, "批准范围参考计价汇总不存在", 409);
          return { ...ap, reference };
        });
      })(),
      cost_nodes: repo.projectCostNodes(key),
      changes: repo.projectChanges(key),
    };
  }
  function preflightLink(project: ReturnType<typeof get>, input: ProjectLinkInput, demand = demands.get(input.demand_id)) {
    requireValue(!Object.hasOwn(input, "quantity_scaled"),
      "子项目只允许整体承接需求，不能另填承接数量；请先修订或拆分需求", 422);
    const blocked = ordinaryLinkReason(project);
    requireValue(!blocked, blocked, 409);
    expectedVersion(demand.current_version,input.expected_version);
    requireValue(demand.status === "active" || demand.status === "pending",
      "仅待承接或待确认的有效需求可以关联项目",422);
    requireValue(!demand.binding,"需求已关联其他子项目，请刷新待承接清单",409);
    return {demand,existing:project.scopes.find(scope=>scope.demand_id===demand.id)};
  }
  function writeLink(actor:Actor,key:string,input:ProjectLinkInput,
    prepared:ReturnType<typeof preflightLink>) {
    const {demand,existing}=prepared;
    const timestamp=now();
    if(existing) {
      const last=repo.latestDemandLinkEvent(existing.id);
      requireValue(last,"需求关联事件历史不完整，请刷新后重试",409);
      repo.appendDemandLink({
        id:id(),project_scope_id:existing.id,
        event_seq:last.event_seq+1,action:"linked",
        actor_id:actor.id,recorded_at:timestamp,reason:input.reason||"",
      });
      return existing.id;
    } else {
      const scopeId = id();
      repo.createDemandScope({
        id:scopeId,project_id:key,demand_id:demand.id,
        demand_version:demand.current_version,
        proposed_quantity_scaled:demand.quantity_scaled,
        created_by:actor.id,created_at:timestamp,updated_at:timestamp,
        demand_snapshot_json:JSON.stringify(demand),
      });
      return scopeId;
    }
  }
  function adoptedOrganization(orgId:string|null,versionId:string|null) {
    requireValue(orgId && versionId,"项目归口单位缺少已采用正式版本",409);
    const record = repo.projectOrganizationVersion(versionId);
    requireValue(record && record.unit_id === orgId,
      "项目归口单位历史采用版本不存在",409);
    return {...record,id:orgId,unit_version_id:versionId};
  }
  function requireAgreementEligible(agreementId: string, frameworkId: string) {
    const agreement = funding.get("agreements", agreementId);
    requireValue(agreement.framework_id === frameworkId,
      "执行协议必须属于本项目所选年度框架", 422);
    requireValue(agreement.status === "active" && !agreement.deleted,
      "执行协议已停用或删除，请选择有效协议", 422);
    const date = today();
    requireValue(
      (!agreement.effective_from || agreement.effective_from <= date) &&
      (!agreement.effective_to || agreement.effective_to >= date),
      "执行协议尚未生效或已过期，请选择当前有效协议", 422);
    return agreement;
  }
  function appendFundingSelection(
    projectId: string, versionNo: number, agreementId: string | null,
    actor: Actor, reason: string,
  ) {
    repo.appendFunding({
      id: id(), project_id: projectId, version_no: versionNo,
      agreement_id: agreementId, actor_id: actor.id, recorded_at: now(),
      reason,
    });
  }

  function save(actor: Actor, input: ProjectManagementInput, key?: string) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const previous = key ? get(key) : null;
      if (previous) {
        requireValue(previous.status !== "closed", "项目已结项，项目档案已冻结", 409);
        expectedVersion(previous.profile_version, input.expected_version);
      }
      const projectId = key || id(),
        timestamp = now();
      const frameworkId = input.framework_id || previous?.framework_id;
      requireValue(typeof frameworkId === "string" && frameworkId.length > 0,
        "请选择年度框架");
      const frameworkChanged = Boolean(previous && frameworkId !== previous.framework_id);
      if (!previous || frameworkChanged) {
        requireValue(!previous || previous.status === "reserve",
          "子项目入库后不可变更年度框架", 409);
        const framework = funding.get("frameworks", frameworkId);
        requireValue(framework.status === "active" && !framework.deleted,
          "请选择有效年度框架", 422);
      }
      const previousAgreementId = previous?.funding?.agreement_id || null;
      // A reserve project's new framework is a valid direct owner without
      // any execution agreement. Do not inherit an old framework's agreement.
      const chosenAgreementId = input.agreement_id === undefined
        ? (frameworkChanged ? null : previousAgreementId)
        : input.agreement_id || null;
      if (input.expected_funding_version !== undefined && previous)
        expectedVersion(previous.funding?.version_no || 0, input.expected_funding_version);
      if (chosenAgreementId && (!previous || frameworkChanged ||
        chosenAgreementId !== previousAgreementId))
        requireAgreementEligible(chosenAgreementId, frameworkId);
      if (!previous) {
        repo.createProject({
          id: projectId,
          code: repo.nextProjectNumber(),
          framework_id: frameworkId,
          created_by: actor.id,
          created_at: timestamp,
        });
      } else if (frameworkChanged) {
        // Detach the old framework's agreement first so the strict SQL guard
        // never sees an invalid cross-framework current association.
        if (previousAgreementId)
          appendFundingSelection(projectId, (previous.funding?.version_no || 0) + 1,
            null, actor, "储备阶段变更年度框架，解除原框架执行协议");
        repo.updateReserveFramework(projectId, frameworkId);
      }
      if (chosenAgreementId !== (frameworkChanged ? null : previousAgreementId)) {
        const currentVersion = (previous?.funding?.version_no || 0) +
          (frameworkChanged && previousAgreementId ? 1 : 0);
        appendFundingSelection(projectId, currentVersion + 1,
          chosenAgreementId, actor, input.reason || "项目档案中选择执行协议");
      }
      for (const key of ["owner_id", "manager_id"] as const)
        if (input[key] && input[key] !== previous?.[key]) {
          const user = repo.projectAccount(input[key]);
          requireValue(
            user &&
              user.status === "active" &&
              !user.deleted,
            "请选择有效责任人或管理人员",
          );
        }
      const category = input.category_id
          ? previous?.category_id === input.category_id
            ? {id:previous.category_id, version:previous.category_version}
            : catalog.get("categories", input.category_id)
          : null,
        organization = input.managing_unit_id
          ? previous?.managing_unit_id === input.managing_unit_id
            ? adoptedOrganization(previous.managing_unit_id, previous.managing_unit_version_id)
            : catalog.get("organizations", input.managing_unit_id)
          : null;
      const profileFields = {
        name: text(input.name, "项目名称"),
        framework_id: frameworkId,
        category_id: category?.id || null,
        category_version: category?.version || null,
        owner_id: input.owner_id || null,
        manager_id: input.manager_id || null,
        managing_unit_id: organization?.id || null,
        managing_unit_version_id: organization?.unit_version_id || null,
        planned_start_on: input.planned_start_on || null,
        planned_end_on: input.planned_end_on || null,
        preliminary_estimate_fen: input.preliminary_estimate_fen ?? null,
        preliminary_estimate_basis: input.preliminary_estimate_basis || null,
      };
      const profileChanged = !previous ||
        Object.entries(profileFields).some(([field, value]) =>
          (previous as Record<string, unknown>)[field] !== value);
      requireValue(profileChanged || chosenAgreementId !== previousAgreementId,
        "项目档案和执行协议均未变化，无需重复保存", 409);
      if (profileChanged)
        repo.appendProfile({
          id: id(), project_id: projectId,
          version_no: (previous?.profile_version || 0) + 1,
          ...profileFields,
          actor_id: actor.id, recorded_at: timestamp, reason: input.reason || "",
        });
      catalog.audit(
        actor,
        "projects",
        projectId,
        previous ? "revise" : "create",
        previous,
        get(projectId),
      );
      return get(projectId);
    });
  }
  function stage(actor: Actor, key: string,
    stageName: "stocked" | "approved" | "closed", permission: string, version: number) {
    authorize(actor, permission);
    const p = get(key);
    expectedVersion(p.version, version);
    if (stageName === "stocked") requireValue(p.status === "reserve", "仅储备项目可办理入库", 409);
    repo.appendStage({
      id: id(),
      project_id: key,
      stage: stageName,
      project_version: p.version + 1,
      actor_id: actor.id,
      created_at: now(),
    });
    return get(key);
  }
  function approvalChangeSummary(project: ReturnType<typeof get>, input: ProjectApprovalInput): string[] {
    const adoptedApproval = project.approval;
    if (!adoptedApproval) return [];
    const previous = project.approvals.find(x => x.id === adoptedApproval.id);
    requireValue(previous, "批准基线历史不存在", 409);
    const reasons = [];
    if (adoptedApproval.approved_budget_fen !== input.approved_budget_fen)
      reasons.push("批准预算发生变化");
    for (const original of previous.scopes) {
      const selected = (input.scopes || []).find(
        x => x.project_scope_id === original.project_scope_id);
      if (!selected) {
        reasons.push(original.demand_no + " 从批准范围中移除");
        continue;
      }
      if (original.demand_version !== selected.demand_version)
        reasons.push(original.demand_no + " 需求正式定义版本已变化，须重新核对作业设备和范围");
      const oldLocations = original.locations.length
        ? original.locations.map(loc => [loc.location_item_no, loc.approved_quantity_scaled])
        : [[1, original.quantity_scaled]];
      const nextLocations = (selected.locations || []).map(
        loc => [loc.location_item_no, loc.approved_quantity_scaled]);
      if (JSON.stringify(oldLocations.sort((a,b)=>a[0]-b[0])) !==
          JSON.stringify(nextLocations.sort((a,b)=>a[0]-b[0])))
        reasons.push(original.demand_no + " 作业位置或批准数量发生变化");
      const oldMaterials = original.materials.map(
        item => [item.material_id, item.approved_quantity_scaled])
        .sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
      const nextMaterials = (selected.materials || []).map(
        item => [item.material_id, item.quantity_scaled])
        .sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
      if (JSON.stringify(oldMaterials) !== JSON.stringify(nextMaterials))
        reasons.push(original.demand_no + " 已批准物资及数量发生变化");
    }
    const previousIds = new Set(previous.scopes.map(x => x.project_scope_id));
    if ((input.scopes || []).some(x => (!x.project_scope_id || !previousIds.has(x.project_scope_id))))
      reasons.push("新增批准需求范围");
    return reasons;
  }
  function persistApprovalScopes(project: ReturnType<typeof get>, approvalId: string,
    selections: ProjectApprovalScopeInput[], timestamp: string, write = true): ProjectApprovalCandidateProposal[] {
    const candidates: ProjectApprovalCandidateProposal[] = [];
    const ruleRefs = selections.map(selected => {
      const scope = project.scopes.find(x => x.id === selected.project_scope_id);
      requireValue(scope?.binding || (!selected.project_scope_id && selected.demand_id && project.status === "approved"), "需求未由本项目关联");
      return { demand_id: scope?.demand_id || selected.demand_id!, version: selected.demand_version };
    });
    const unitRules = quantityUnits.demandUnits(ruleRefs);
    const materialRules = quantityUnits.materialUnits(selections.flatMap(
      selected => (selected.materials || []).map(material => material.material_id)));
    const materialLinks = repo.projectScopeMaterialLinks(selections.map(selected => selected.project_scope_id).filter((id): id is string => Boolean(id)));

    for (const selected of selections) {
      const scope = project.scopes.find(
        (x) => x.id === selected.project_scope_id,
      );
      requireValue(scope?.binding || (!selected.project_scope_id && selected.demand_id && project.status === "approved"), "需求未由本项目关联");
      const demand = demands.get(scope?.demand_id || selected.demand_id!);
      requireValue(demand.status === "active", "批准范围须采用已确认的有效需求", 409);
      if (!scope) requireValue(!demand.binding, "候选需求已由其他项目关联，请重新核对变更", 409);
      expectedVersion(demand.current_version, selected.demand_version);
      const locations = selected.locations;
      requireValue(
        Array.isArray(locations) && locations.length === demand.work_locations.length,
        "子项目必须承接需求全部位置；如需部分实施，请先正式修订或拆分专业需求", 422,
      );
      const unitRule = unitRules.get(demand.id + ":" + demand.current_version);
      requireValue(unitRule, "需求采用的计量单位正式版本不存在", 404);
      const locationItems = new Map(demand.work_locations.map(location =>
        [location.item_no, location.quantity_scaled]));
      const usedItems = new Set<number>();
      for (const [index, loc] of locations.entries()) {
        requireValue(locationItems.has(loc.location_item_no) && !usedItems.has(loc.location_item_no),
          "批准作业位置必须完整且来自需求正式版本，不得重复", 422,
          { [`scopes.${selected.project_scope_id}.locations.${index}`]: "请核对真实作业位置" });
        usedItems.add(loc.location_item_no);
        assertQuantityPrecision(integer(loc.approved_quantity_scaled, "批准位置数量", 1),
          unitRule.fields_json, unitRule.name,
          `scopes.${selected.project_scope_id}.locations.${index}.approved_quantity_scaled`);
        requireValue(loc.approved_quantity_scaled === locationItems.get(loc.location_item_no),
          "子项目不得调整单个需求位置的数量；请先正式修订或拆分需求", 422,
          { [`scopes.${selected.project_scope_id}.locations.${index}.approved_quantity_scaled`]: "必须与当前需求数量完全一致" });
      }

      const total = locations.reduce(
        (sum, loc) =>
          sum + integer(loc.approved_quantity_scaled, "批准位置数量", 1),
        0,
      );
      const versions: Record<string, string> = {};
      for (const material of selected.materials || []) {
        const rule = materialRules.get(material.material_id);
        requireValue(rule, "批准物资采用的计量单位不存在", 404);
        assertQuantityPrecision(integer(material.quantity_scaled, "批准物资数量", 1), rule.fields_json, rule.name, "materials.quantity_scaled");
        requireValue(!selected.expected_material_versions ||
          selected.expected_material_versions[material.material_id] === rule.material_version_id,
          "候选需求的批准物资定义已变化，请重新编制变更草稿", 409);
        versions[material.material_id] = rule.material_version_id;
      }
      if (!scope) candidates.push({ ...selected, demand_id: demand.id,
        expected_material_versions: versions, snapshot: demand });
      if (!write || !scope) continue;
      const scopeId = id();
      repo.appendApprovalScope({
        id: scopeId,
        approval_version_id: approvalId,
        project_scope_id: scope.id,
        demand_id: demand.id,
        demand_version: demand.current_version,
        quantity_scaled: total,
        approved_amount_fen: selected.approved_amount_fen ?? null,
        snapshot_json: JSON.stringify(demand),
        created_at: timestamp,
      });
      if (demand.work_locations.length > 1)
        for (const loc of locations)
          repo.appendApprovalPosition({
            approval_scope_version_id: scopeId,
            demand_id: demand.id,
            demand_version: demand.current_version,
            location_item_no: loc.location_item_no,
            approved_quantity_scaled: loc.approved_quantity_scaled,
          });
      else
        requireValue(
          locations.length === 1 && locations[0].location_item_no === 1,
          "批准位置无效",
        );
      // Material approval is explicit. No proportional derivation from demand quantities.
      for (const [index, item] of (selected.materials || []).entries()) {
        const format = materialRules.get(item.material_id);
        requireValue(format, "批准物资采用的计量单位不存在", 404);
        assertQuantityPrecision(integer(item.quantity_scaled, "批准物资数量", 1),
          format.fields_json, format.name,
          `scopes.${selected.project_scope_id}.materials.${index}.quantity_scaled`);
        const materialLinkKey = scope.id + ':' + format.material_id;
        let identity = materialLinks.get(materialLinkKey);
        if (!identity) {
          identity = {
            id: id(),
            project_scope_id: scope.id,
            material_id: format.material_id,
            created_at: timestamp,
          };
          repo.createProjectMaterial(identity);
          materialLinks.set(materialLinkKey, identity);
        }
        repo.appendApprovedMaterial({
          id: id(),
          approval_version_id: approvalId,
          project_scope_id: scope.id,
          project_material_id: identity.id,
          material_version_id: format.material_version_id,
          item_no: index + 1,
          material_code_snapshot: format.material_code,
          material_name: format.material_name,
          material_model: format.material_model,
          specification: format.material_specification,
          approved_quantity_scaled: item.quantity_scaled,
          unit_id: format.unit_id,
          unit_version: format.unit_version,
          unit_snapshot: format.name,
        });
      }
    }
    return candidates;
  }
  function checkApproval(project: ReturnType<typeof get>, approval: ReturnType<typeof get>["approvals"][number]) {
    requireValue(approval.status === "draft", "仅能批准仍有效的草稿", 409);
    const key = project.id;
    const candidates = approval.pending_scopes;
    for (const candidate of candidates) {
      const demand = demands.get(candidate.demand_id);
      expectedVersion(demand.current_version, candidate.demand_version);
      requireValue(!demand.binding && demand.status === "active", "候选需求已由其他项目关联或状态变化，请重新编制变更", 409);
      requireValue(demand.expected_on, "新增候选需求须填写预计解决时间", 422);
    }
    const missingDates = repo.missingExpectedResolutionDates(key);
    requireValue(!missingDates.length,
      "正式批准前必须填写本项目所有当前关联需求的预计解决时间：" +
        missingDates.map(row=>row.demand_no).join("、"),
      422,{expected_on:missingDates.map(row=>row.demand_no)});
    const staleDemands = repo.staleApprovalDemands(approval.id);
    requireValue(!staleDemands.length,
      "需求正式版本已变化，请重新编制草稿并核对最新位置、数量和预计解决时间：" + staleDemands.map(scope => scope.demand_no).join("、"),
      409, { expected_on: staleDemands.map(scope => scope.demand_no) });
    return candidates;
  }
  function approvalBlockReason(project: ReturnType<typeof get>) {
    const approval = project.approvals.find(row => row.status === "draft");
    if (!approval) return "";
    try {
      checkApproval(project, approval);
      return "";
    } catch (error) {
      if (!(error instanceof BusinessError)) throw error;
      return error.message;
    }
  }
  function approvalDraft(actor: Actor, key: string, input: ProjectApprovalInput) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const project = get(key);
      expectedVersion(project.version, input.expected_version);
      const blocked = approvalDraftReason(project);
      requireValue(!blocked, blocked, 409);
      requireValue(
        (input.expected_approval_version_id ?? null) ===
          (project.approval?.id ?? null),
        "项目批准基线已变化，请刷新后重新编制",
        409,
      );
      requireValue(Array.isArray(input.scopes) && input.scopes.length > 0, "请明确批准需求范围");
      const demandIdentities = input.scopes.map(selected => selected.demand_id ||
        project.scopes.find(scope => scope.id === selected.project_scope_id)?.demand_id);
      requireValue(demandIdentities.every(Boolean) && new Set(demandIdentities).size === demandIdentities.length,
        "同一需求不能重复纳入批准范围", 422);
      const candidates = persistApprovalScopes(project, "", input.scopes, now(), false);
      const changes = approvalChangeSummary(project, input);
      if (candidates.length) changes.push("新增候选需求，正式批准时统一建立关联");
      requireValue(!changes.length || input.confirm_changes === true,
        "正式变更涉及批准范围、数量、物资或预算调整，请核对差异并明确确认", 409,
        { changes });
      const previous = project.approval,
        approvalId = id(),
        version = project.approvals.length + 1,
        timestamp = now();
      let changeId = null;
      if (version > 1) {
        requireValue(previous, "缺少正式批准基线");
        changeId = id();
        repo.proposeChange({
          id: changeId,
          project_id: key,
          code: repo.nextChangeNumber(),
          base_approval_version_id: previous.id,
          proposal_json: JSON.stringify(input),
          created_by: actor.id,
          created_at: timestamp,
          reason: input.reason || "",
        });
      }
      repo.createApproval({
        id: approvalId,
        project_id: key,
        version_no: version,
        change_order_id: changeId,
        snapshot_json: JSON.stringify({
          project_profile_version: project.profile_version,
          basis: input.basis || "",
          candidate_scopes: candidates,
        }),
        approved_budget_fen: integer(input.approved_budget_fen, "批准预算"),
        created_at: timestamp,
      });
      persistApprovalScopes(project, approvalId, input.scopes, timestamp);
      return get(key);
    });
  }
  // Agreement balances are a budget *comparison*, not a funds-allocation
  // ledger. Only the latest funding link and latest formally approved project
  // budget contribute to the reference figures.
  function eligibleAgreementOptions(frameworkId: string, selectedId: string | null = null) {
    const framework = funding.get("frameworks", frameworkId);
    requireValue(!framework.deleted, "年度框架已删除，不可选用", 422);
    const currentDate = today();
    const linked = new Map(repo.agreementUsageTotals().map(row => {
      requireValue(Number.isSafeInteger(row.approved_budget_fen),
        "关联项目预算汇总超出安全范围");
      return [row.agreement_id,
        {projects:row.projects,approved_budget_fen:row.approved_budget_fen}] as const;
    }));
    const agreements = funding.list("agreements", true)
      .filter(agreement => agreement.framework_id === frameworkId)
      .map(agreement => {
        const eligible = !agreement.deleted && agreement.status === "active" &&
          (!agreement.effective_from || agreement.effective_from <= currentDate) &&
          (!agreement.effective_to || agreement.effective_to >= currentDate);
        const used = linked.get(agreement.id) || {
          projects: 0, approved_budget_fen: 0,
        };
        return {
          id: agreement.id, code: agreement.code, name: agreement.name,
          framework_id: agreement.framework_id, status: agreement.status,
          counterparty_name: agreement.counterparty_name,
          contract_number: agreement.contract_number,
          effective_from: agreement.effective_from,
          effective_to: agreement.effective_to,
          deleted: agreement.deleted, eligible,
          limit_fen: agreement.limit_fen,
          linked_projects_count: used.projects,
          linked_approved_budget_fen: used.approved_budget_fen,
          budget_difference_fen: agreement.limit_fen -
            used.approved_budget_fen,
        };
      });
    return agreements.filter(row => row.eligible || row.id === selectedId)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }
  function agreementOptions(key: string) {
    const project = get(key);
    const selectedId = project.funding?.agreement_id || null;
    return {
      framework_id: project.framework_id,
      current_agreement_id: selectedId,
      project_approved_budget_fen: project.approval?.approved_budget_fen ?? null,
      options: eligibleAgreementOptions(project.framework_id, selectedId),
    };
  }
  function search(query: ListQuery) {
    const result = repo.searchProjects(query);
    return { ...result, items: result.items.map(({ approval_json, scopes_json, funding_json, ...row }) => ({
      ...row, approval: approval_json ? JSON.parse(approval_json) as Pick<ProjectApprovalVersion, "id" | "version_no" | "approved_budget_fen"> : null,
      scopes: JSON.parse(scopes_json || "[]") as ProjectScopeListItem[], funding: funding_json ? JSON.parse(funding_json) as Pick<ProjectFundingVersion, "id" | "version_no" | "agreement_id"> : null,
      deleted: Boolean(row.deleted),
    })) };
  }
  return {
    get,
    save,
    approvalDraft,
    approvalBlockReason,
    agreementOptions,
    availableAgreements(frameworkId: string, selectedId: string | null = null) {
      return { framework_id: frameworkId,
        options: eligibleAgreementOptions(frameworkId, selectedId) };
    },
    search,
    handlingQueue(actor: Actor, kind: "compile" | "initial" | "change", query: ListQuery) {
      authorize(actor, kind === "compile" ? "write" : kind === "initial" ? "project.approve" : "change.approve");
      const state = kind === "compile" ? "已入库" : kind === "initial" ? "立项中" : "变更中";
      const page = search({ ...query, deleted: false, filters: { ...query.filters, display_status: state } });
      return { ...page, items: page.items.map(row => ({
        id: row.id,
        name: row.name,
        reason: kind === "compile"
          ? row.scopes.some(scope => scope.binding && scope.demand_status === "active") ? "" : "请先关联已确认需求"
          : approvalBlockReason(get(row.id, false, true)),
      })) };
    },
    projectReportRows(actor: Actor, ids: string[], query?: ListQuery) {
      authorize(actor, "read");
      const unique = [...new Set(ids)];
      requireValue(unique.length <= 5000, "最多导出5000个子项目");
      requireValue(unique.length > 0 || query, "请先选择导出的子项目范围");
      const rows = unique.length ? repo.selectedProjects(unique) : repo.searchProjects({ ...query!, page: 1, page_size: 5001 }).items;
      requireValue(!unique.length || rows.length === unique.length, "所选项目已删除或不存在，请刷新后重选", 409);
      requireValue(rows.length <= 5000, "导出超过5000条，请收窄筛选条件");
      return rows.map(row => ({
        id: row.id, 项目编号: row.code, 项目名称: row.name, 项目状态: row.display_status,
        归档状态: row.deleted ? "已归档删除" : "",
        "批准预算（元）": row.approval_json ? (JSON.parse(row.approval_json) as Pick<ProjectApprovalVersion, "approved_budget_fen">).approved_budget_fen / 100 : null,
        关联需求数: (JSON.parse(row.scopes_json) as ProjectScopeListItem[]).filter(scope => scope.binding).length,
      }));
    },
    dashboardPortfolio(ids?: string[], includeDeleted = false) {
      return repo.projectDashboardPortfolio(ids, includeDeleted);
    },
    workspace(key: string, includeDeleted = false) {
      return get(key, includeDeleted, true);
    },
    approvalCandidates(key: string) {
      get(key, true, true);
      return repo.projectApprovalCandidates(key);
    },
    approvalHistory(key: string) {
      get(key, true, true);
      const approvals = repo.projectApprovalHistory(key);
      const summaries = pricing.projectSummaries(key, approvals.map(ap => ap.id));
      return approvals.map(ap => {
        const reference = summaries.get(ap.id);
        requireValue(reference, "批准范围参考计价汇总不存在", 409);
        return { ...ap, reference };
      });
    },
    summaryBasis(key: string) {
      const basis = repo.projectSummaryBasis(key);
      requireValue(basis, "项目不存在或已删除", 404);
      return basis;
    },
    list(includeDeleted = false) {
      const deleted = repo.deletedProjectIds();
      return repo.projectIdentities()
        .filter((x) => includeDeleted || !deleted.has(x.id))
        .map((x) => ({
          ...get(x.id, includeDeleted),
          deleted: deleted.has(x.id),
        }));
    },
    createFromDemand(actor: Actor, input: ProjectFromDemandInput) {
      authorize(actor, "write");
      // One application use case and one database transaction: no orphaned
      // project if the final demand-link check rejects a stale version.
      return repo.transaction(() => {
        requireValue(typeof input.demand_id === "string" && input.demand_id,
          "请选择要承接的专业需求");
        const demand = demands.get(input.demand_id);
        expectedVersion(demand.current_version, input.expected_demand_version);
        requireValue(demand.status === "active", "请先确认需求有效，再建立正式承接项目");
        requireValue(!demand.binding, "需求已被其他项目承接", 409);
        const created = save(actor, input);
        return this.link(actor, created.id, {
          demand_id: demand.id,
          expected_version: demand.current_version,
        });
      });
    },
    stock(actor: Actor, key: string, input: ProjectVersionAction) {
      return repo.transaction(() =>
        stage(actor, key, "stocked", "project.stock", input.expected_version),
      );
    },
    previewStock(actor: Actor, targets: HandlingTarget[]): HandlingReviewRow[] {
      authorize(actor, "project.stock");
      return targets.map(target => {
        const root = repo.projectIdentity(target.id);
        const profile = root && repo.latestProjectProfile(target.id);
        const reason = !root || !profile || repo.projectDeleted(target.id) ? "项目不存在或已删除"
          : root.version !== target.expected_version ? "项目版本已变化，请重新选择"
          : root.status !== "reserve" ? "仅储备项目可办理入库" : "";
        return { ...target, label: profile?.name || root?.code || target.id, reason };
      });
    },
    stockMany(actor: Actor, targets: HandlingTarget[]) {
      authorize(actor, "project.stock");
      return repo.transaction(() => {
        for (const target of targets) stage(actor, target.id, "stocked", "project.stock", target.expected_version);
        return { count: targets.length };
      });
    },
    previewLinkMany(actor: Actor, key: string, input: ProjectLinkBatchInput): HandlingReviewRow[] {
      authorize(actor, "write");
      const project = get(key);
      return input.links.map(link => {
        let label = link.demand_id;
        try {
          const demand = demands.get(link.demand_id);
          label = demand.demand_no + " · " + demand.problem_description;
          preflightLink(project, link, demand);
          return { id: link.demand_id, expected_version: link.expected_version, label, reason: "" };
        } catch (error) {
          if (!(error instanceof BusinessError)) throw error;
          return { id: link.demand_id, expected_version: link.expected_version, label, reason: error.message };
        }
      });
    },
    link(actor: Actor, key: string, input: ProjectLinkInput) {
      authorize(actor,"write");
      return repo.transaction(()=>{
        const project=get(key);
        const prepared=preflightLink(project,input);
        writeLink(actor,key,input,prepared);
        return get(key);
      });
    },
    linkMany(actor: Actor, key: string, input: ProjectLinkBatchInput) {
      authorize(actor,"write");
      requireValue(input.links.length > 0 && input.links.length <= 100,
        "一次请选择1～100条需求关联",422);
      requireValue(new Set(input.links.map(row=>row.demand_id)).size === input.links.length,
        "同一条需求不能重复关联",422);
      // Validate ALL before first write; SQLite transaction rolls back if
      // any binding changes between preflight and actual insert.
      return repo.transaction(()=>{
        const project=get(key);
        const prepared=input.links.map(link=>preflightLink(project,link));
        for(let index=0;index<input.links.length;index++)
          writeLink(actor,key,input.links[index],prepared[index]);
        return get(key);
      });
    },
    release(actor: Actor, key: string, scopeId: string, input: ProjectReleaseInput) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const project = get(key, true);
        if (project.deleted) authorize(actor, "admin");
        const scope = project.scopes.find((x) => x.id === scopeId);
        requireValue(scope, "关联不存在", 404);
        requireValue(scope.binding, "需求当前未关联，不能重复解绑", 409);
        // Mirror the database triggers at the service boundary so users
        // receive a business conflict rather than an ERR_SQLITE_ERROR stack.
        const draftContainsScope = project.approvals.some(approval =>
          approval.status === "draft" &&
          approval.scopes.some(item => item.project_scope_id === scopeId));
        requireValue(!draftContainsScope,
          "仍有立项或变更草稿引用需求，须先移出草稿再解绑", 409);
        const latestApproved = project.approvals
          .filter(approval => approval.status === "approved")
          .sort((a, b) => b.version_no - a.version_no)[0];
        requireValue(!latestApproved?.scopes.some(item => item.project_scope_id === scopeId),
          project.status === "closed"
            ? "项目已结项，最新版正式批准范围仍包含该需求，不能解绑"
            : "已正式批准的在办项目须先通过最新版范围变更移出需求，才能解绑", 409);
        const last = repo.latestDemandLinkEvent(scopeId);
        requireValue(last, "关联历史不存在", 409);
        expectedVersion(last.event_seq, input.expected_event_seq);
        repo.appendDemandLink({
          id: id(),
          project_scope_id: scopeId,
          event_seq: last.event_seq + 1,
          action: "released",
          actor_id: actor.id,
          recorded_at: now(),
          reason: input.reason || "",
        });
        return get(key, true);
      });
    },
    fund(actor: Actor, key: string, input: ProjectFundingInput) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const project = get(key);
        return save(actor, {
          ...project,
          expected_version: project.profile_version,
          expected_funding_version: input.expected_version,
          agreement_id: input.agreement_id || null,
          reason: input.reason,
        }, key);
      });
    },
    approve(actor: Actor, key: string, approvalId: string, input: ProjectVersionAction) {
      return repo.transaction(() => {
        const project = get(key),
          approval = project.approvals.find((ap) => ap.id === approvalId);
        requireValue(approval, "批准版本不存在", 404);
        expectedVersion(project.version, input.expected_version);
        authorize(
          actor,
          approval.version_no === 1 ? "project.approve" : "change.approve",
        );
        const candidates = checkApproval(project, approval);
        if (approval.change_order_id)
          repo.decideChange(approval.change_order_id, {
            status: "approved",
            decided_by: actor.id,
            decided_at: now(),
            decision_reason: input.reason || "",
          });
        if (candidates.length) {
          const selected: ProjectApprovalScopeInput[] = [];
          for (const candidate of candidates) {
            const demand = demands.get(candidate.demand_id);
            const scopeId = writeLink(actor, key, { demand_id: demand.id, expected_version: demand.current_version },
              { demand, existing: project.scopes.find(scope => scope.demand_id === demand.id) });
            selected.push({ ...candidate, demand_id: undefined, project_scope_id: scopeId });
          }
          persistApprovalScopes(get(key), approvalId, selected, now());
        }
        repo.decideApproval(approvalId, {
          status: "approved",
          approved_by: actor.id,
          approved_at: now(),
        });
        if (approval.version_no === 1)
          stage(actor, key, "approved", "project.approve", project.version);
        if (project.approval) {
          const previous = project.approvals.find(row => row.id === project.approval!.id);
          const retained = new Set(get(key).approvals.find(row => row.id === approvalId)!.scopes.map(row => row.project_scope_id));
          for (const scope of previous?.scopes || []) {
            if (retained.has(scope.project_scope_id)) continue;
            const last = repo.latestDemandLinkEvent(scope.project_scope_id);
            requireValue(last, "移出需求的关联历史不存在", 409);
            repo.appendDemandLink({ id: id(), project_scope_id: scope.project_scope_id,
              event_seq: last.event_seq + 1, action: "released", actor_id: actor.id,
              recorded_at: now(), reason: input.reason || "正式范围变更批准后移出需求" });
          }
        }
        return get(key);
      });
    },
    discardApproval(actor: Actor, key: string, approvalId: string) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const approval = get(key).approvals.find((x) => x.id === approvalId);
        requireValue(approval?.status === "draft", "只能删除未批准草稿");
        catalog.audit(
          actor,
          "approval_drafts",
          approvalId,
          "delete",
          approval,
          { status: "withdrawn" },
        );
        repo.decideApproval(approvalId, {
          status: "withdrawn",
        });
        if (approval.change_order_id)
          repo.decideChange(approval.change_order_id, {
            status: "rejected",
            decided_by: actor.id,
            decided_at: now(),
            decision_reason: "",
          });
        return get(key);
      });
    },
    previewDeletion(actor: Actor, key: string) {
      authorize(actor, "admin");
      const project = get(key, false, true);
      return {
        name: project.name, version: project.version, reason: projectDeleteReason(project),
        linked_demands: project.scopes.filter(scope => scope.binding).map(scope => scope.demand_no),
        approved_version: project.approval?.version_no ?? null,
      };
    },
    remove(actor: Actor, key: string, input: ProjectVersionAction) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const project = get(key);
        expectedVersion(project.version, input.expected_version);
        const blocked = projectDeleteReason(project);
        requireValue(!blocked, blocked, 409);
        catalog.audit(actor, "projects", key, "delete", project, {
          logical: true,
        });
        return { deleted: true };
      });
    },
    history(key: string) {
      get(key, true, true);
      return repo.projectFullHistory(key);
    },
    historyTimeline(key: string, query: HistoryQuery, pageSize: number) {
      const root = repo.projectIdentity(key);
      const profile = root && repo.latestProjectProfile(key);
      requireValue(root && profile, "项目不存在或档案版本不存在", 404);
      const { approval, draft } = repo.projectTimelineBasis(key);
      return {
        project: { ...root, name: profile.name, profile_version: profile.version_no,
          deleted: repo.projectDeleted(key), display_status: projectDisplayStatus(root.status, draft ? [{ status: "draft" }] : []) },
        approval, timeline: repo.projectTimeline(key, query, pageSize),
      };
    },
    historyDetail(key: string, source: Parameters<typeof repo.projectTimelineDetails>[1], rowId: string) {
      const { records, approvalIds } = repo.projectTimelineDetails(key, source, rowId);
      const approvals = approvalIds.length ? repo.projectApprovalHistory(key, false, approvalIds) : [];
      const summaries = pricing.summariesForApprovals(approvalIds);
      return { records, approvals: approvals.map(approval => {
        const reference = summaries.get(approval.id);
        requireValue(reference, "批准范围参考计价汇总不存在", 409);
        return { ...approval, reference };
      }) };
    },
  };
}
export type ProjectService = ReturnType<typeof createProjects>;
