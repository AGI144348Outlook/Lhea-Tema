# Contract 000 — architectures maintenance

**First instruction: perform the File by File Verification Audit in [Contract000_auditskills.md](Contract000_auditskills.md), beginning with verification of its list-only repository mirror.**

## Scope and upkeep

Components, boundaries, dependencies, locality, layers, state ownership and composition structures.

Resolve the represented branch from the parent folder's BRANCHES.json mapping. The audit header lists all repository branches; use its branch-membership column to select the represented branch's complete source file list. Audit files sequentially in recorded path order. Read contents; directory presence and fingerprints alone do not count as contextual auditing. Inspect archive members and structured/binary formats using appropriate read-only readers; record limitations and unread members explicitly. Do not execute untrusted project code as a reading shortcut.

Resume [Contract000_checkpoint.json](Contract000_checkpoint.json). Record exact last completed file, within-file/member position, source pins, findings/no-findings and next file. A bounded visit may stop incomplete and route with a durable checkpoint; it must never say the entire branch was read. Retain partial coverage when the next category or repository is attended. Revisit changed source files without discarding old source-linked findings.

Update [the accumulator](../Contract000_architectures.md) only with architectures-relevant discoveries. Preserve other categories through cross-references. Record the category's contracts, context and limitations with implementation references.

## Before handing off

Run [000_CuratorVerification.md](000_CuratorVerification.md) to reconcile source coverage and update the directory header, then save the exact pending position. Tests, diagnostics, benchmarks and CI require a prospective issue/discussion entry in this repository with hypothesis, method, expected and disconfirming outcomes, followed by actual results in the same thread. If posting is blocked, do not run tests. Main authorization here covers maintenance documents; application merges, deployments, credentials and paid actions require their own existing authority.

## Final directory routing protocol

NEXT: [interfaces maintenance](../../interfaces/Contract_ReadMe/Contract000_readme.md). Pass repository, represented branch, source commit, category, next-file/member position, findings, unresolved items and completion state. Follow that exact target; routing text is a handoff instruction, not proof an autonomous process ran.
