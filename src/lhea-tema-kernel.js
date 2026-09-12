/**
 * LHEA-TEMA Kernel Worker v2 + Workers AI
 *
 * Bindings required in Cloudflare dashboard:
 *   STAMP_REGISTRY  — D1 — mashet-stamp-registry
 *   WORLD_STATE     — D1 — mashet-world-state
 *   TEMA_SUBSTRATE  — D1 — mashet-tema-substrate
 *   AI              — Workers AI (add as "AI" binding, no config needed)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// EBA thresholds
const THETA_SHED    = 0.3;
const THETA_DROP    = 0.1;
const LAMBDA_CEIL   = 0.85;
const C_MIN         = 0.2;
const M_MIN         = 2;
const M_HARD        = 10;
const C_PRECIPITATE = 5;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    try {

      // ── Health ──────────────────────────────────────────────────
      if (path === '/health') {
        return json({
          status: 'online',
          system: 'LHEA-TEMA Kernel v2',
          databases: {
            stamp_registry: 'mashet-stamp-registry',
            world_state:    'mashet-world-state',
            tema_substrate: 'mashet-tema-substrate',
          },
          ai: typeof env.AI !== 'undefined' ? 'bound' : 'unbound',
        });
      }

      // ── AI Chat ─────────────────────────────────────────────────
      if (path === '/ai/chat' && request.method === 'POST') {
        return await aiChat(request, env);
      }

      // ── Registry ────────────────────────────────────────────────
      if (path === '/registry/root'  && request.method === 'GET')  return await resolveRoot(url, env);
      if (path === '/registry/glyph' && request.method === 'GET')  return await resolveGlyph(url, env);
      if (path === '/registry/roots' && request.method === 'GET')  return await listRoots(env);
      if (path === '/registry/glyphs'&& request.method === 'GET')  return await listGlyphs(env);

      // ── Kernel execution ────────────────────────────────────────
      if (path === '/kernel/execute' && request.method === 'POST') {
        return await executeISATriplet(await request.json(), env);
      }

      // ── TEMA ────────────────────────────────────────────────────
      if (path === '/tema/core'   && request.method === 'GET') return await getTEMACore(env);
      if (path === '/tema/ocean'  && request.method === 'GET') return await getTEMAOcean(env);
      if (path === '/tema/cave'   && request.method === 'GET') return await getTEMACave(env);
      if (path === '/tema/nexus'  && request.method === 'GET') return await getNexusValves(env);
      if (path === '/tema/eba'    && request.method === 'POST') return await runEBA(env);

      // ── World state ─────────────────────────────────────────────
      if (path === '/world/icons'                && request.method === 'GET')  return await listIcons(env);
      if (path === '/world/icon'                 && request.method === 'GET')  return await getIcon(url, env);
      if (path === '/world/observe'              && request.method === 'POST') return await recordObservation(await request.json(), env);
      if (path === '/world/jurisdictions'        && request.method === 'GET')  return await listJurisdictions(env);
      if (path === '/world/jurisdiction/check'   && request.method === 'POST') return await checkJurisdiction(await request.json(), env);

      // ── Scene ───────────────────────────────────────────────────
      if (path === '/scene' && request.method === 'GET') return await getSceneData(env);

      return json({ error: 'Route not found', path }, 404);

    } catch (err) {
      return json({ error: err.message, system: 'KernelFault' }, 500);
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════════════════════════

async function aiChat(request, env) {
  if (!env.AI) {
    return json({
      error: 'Workers AI not bound. Add an AI binding named "AI" in your Worker settings.',
    }, 503);
  }

  const { messages, model } = await request.json();

  if (!messages || !Array.isArray(messages)) {
    return json({ error: 'messages array required' }, 400);
  }

  const selectedModel = model || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  // Inject live kernel context into system message
  let kernelContext = '';
  try {
    const [rootCount, glyphCount, iconCount, coreState] = await Promise.all([
      env.STAMP_REGISTRY.prepare('SELECT COUNT(*) as n FROM latin_roots').first(),
      env.STAMP_REGISTRY.prepare('SELECT COUNT(*) as n FROM hebrew_glyphs').first(),
      env.WORLD_STATE.prepare('SELECT COUNT(*) as n FROM indus_icons').first(),
      env.TEMA_SUBSTRATE.prepare(
        'SELECT COUNT(*) as n, MAX(eigenvalue_weight) as lmax FROM context_droplets WHERE layer="CORE"'
      ).first(),
    ]);

    const lmax   = coreState?.lmax || 0;
    const cscope = lmax > 0 ? Math.min(1, 1 / lmax).toFixed(3) : '1.000';

    kernelContext = `\n\n[LIVE KERNEL STATE]\n` +
      `Latin roots: ${rootCount?.n || 0} | Hebrew glyphs: ${glyphCount?.n || 0}\n` +
      `Icons active: ${iconCount?.n || 0}\n` +
      `TEMA Core droplets: ${coreState?.n || 0} | λmax: ${lmax.toFixed(3)} | C_scope: ${cscope}`;
  } catch { /* non-fatal */ }

  // Inject context into system message
  const enrichedMessages = messages.map((m, i) => {
    if (m.role === 'system' && i === 0) {
      return { ...m, content: m.content + kernelContext };
    }
    return m;
  });

  try {
    const result = await env.AI.run(selectedModel, {
      messages: enrichedMessages,
      max_tokens: 1024,
    });

    return json({ result, model: selectedModel });

  } catch (err) {
    return json({ error: `Workers AI error: ${err.message}`, model: selectedModel }, 500);
  }
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════════

async function resolveRoot(url, env) {
  const root = url.searchParams.get('root');
  if (!root) return json({ error: 'Missing ?root= param' }, 400);

  const result = await env.STAMP_REGISTRY.prepare(`
    SELECT r.id, r.root, r.core_meaning, r.semantic_vector,
           r.myelination_count, r.node_type,
           g.glyph, g.name as glyph_name, g.operator_class,
           g.traversal_function, rga.affinity_rank
    FROM latin_roots r
    JOIN root_glyph_affinities rga ON r.id = rga.root_id
    JOIN hebrew_glyphs g ON g.id = rga.glyph_id
    WHERE r.root = ?
    ORDER BY rga.affinity_rank
  `).bind(root).all();

  if (!result.results.length) {
    return json({ error: `Root '${root}' not found in Registry Legend` }, 404);
  }

  const base = result.results[0];
  return json({
    root:              base.root,
    core_meaning:      base.core_meaning,
    semantic_vector:   base.semantic_vector,
    myelination_count: base.myelination_count,
    node_type:         base.node_type,
    glyph_affinities:  result.results.map(r => ({
      glyph:              r.glyph,
      glyph_name:         r.glyph_name,
      operator_class:     r.operator_class,
      traversal_function: r.traversal_function,
      affinity_rank:      r.affinity_rank,
    })),
  });
}

async function resolveGlyph(url, env) {
  const name = url.searchParams.get('name') || url.searchParams.get('glyph');
  if (!name) return json({ error: 'Missing ?name= or ?glyph= param' }, 400);

  const glyph = await env.STAMP_REGISTRY.prepare(
    `SELECT * FROM hebrew_glyphs WHERE name = ? OR glyph = ?`
  ).bind(name, name).first();

  if (!glyph) return json({ error: `Glyph '${name}' not found` }, 404);

  const roots = await env.STAMP_REGISTRY.prepare(`
    SELECT r.root, r.core_meaning, r.semantic_vector, rga.affinity_rank
    FROM root_glyph_affinities rga
    JOIN latin_roots r ON r.id = rga.root_id
    WHERE rga.glyph_id = ?
    ORDER BY rga.affinity_rank, r.root
  `).bind(glyph.id).all();

  return json({
    glyph:              glyph.glyph,
    name:               glyph.name,
    operator_class:     glyph.operator_class,
    traversal_function: glyph.traversal_function,
    core_profile:       glyph.core_profile,
    latin_roots:        roots.results,
  });
}

async function listRoots(env) {
  const result = await env.STAMP_REGISTRY.prepare(
    `SELECT root, core_meaning, semantic_vector, myelination_count, node_type
     FROM latin_roots ORDER BY root`
  ).all();
  return json({ count: result.results.length, roots: result.results });
}

async function listGlyphs(env) {
  const result = await env.STAMP_REGISTRY.prepare(
    `SELECT glyph, name, transliteration, operator_class, traversal_function, core_profile
     FROM hebrew_glyphs ORDER BY id`
  ).all();
  return json({ count: result.results.length, glyphs: result.results });
}

// ═══════════════════════════════════════════════════════════════
// KERNEL: ISA TRIPLET EXECUTION
// ═══════════════════════════════════════════════════════════════

async function executeISATriplet(body, env) {
  const { latin_root, hebrew_glyph, indus_icon, context } = body;

  if (!latin_root || !hebrew_glyph || !indus_icon) {
    return json({
      error:  'ISA triplet requires: latin_root, hebrew_glyph, indus_icon',
      format: '[latin_root] [hebrew_glyph] [indus_icon]',
    }, 400);
  }

  // Phase 1 — Lexer
  const root = await env.STAMP_REGISTRY.prepare(
    `SELECT * FROM latin_roots WHERE root = ?`
  ).bind(latin_root).first();

  if (!root) return json({
    error: `IntegrityFault: Latin root '${latin_root}' not in Registry Legend`,
    phase: 'LEXER',
  }, 422);

  // Phase 2 — Parser
  const glyph = await env.STAMP_REGISTRY.prepare(
    `SELECT * FROM hebrew_glyphs WHERE name = ? OR glyph = ?`
  ).bind(hebrew_glyph, hebrew_glyph).first();

  if (!glyph) return json({
    error: `IntegrityFault: Hebrew glyph '${hebrew_glyph}' not in Registry`,
    phase: 'PARSER',
  }, 422);

  const affinity = await env.STAMP_REGISTRY.prepare(`
    SELECT rga.affinity_rank FROM root_glyph_affinities rga
    JOIN latin_roots r ON r.id = rga.root_id
    JOIN hebrew_glyphs g ON g.id = rga.glyph_id
    WHERE r.root = ? AND (g.name = ? OR g.glyph = ?)
  `).bind(latin_root, hebrew_glyph, hebrew_glyph).first();

  const compatible   = !!affinity;
  const affinityRank = affinity?.affinity_rank ?? null;

  // Phase 3 — Whole-Integrity Guard
  if (root.node_type === 'CORE_NODE' && hebrew_glyph.toLowerCase().includes('diminish')) {
    return json({
      error: 'IntegrityViolation: Cannot diminish a CORE_NODE. The Whole is indivisible.',
      phase: 'INTEGRITY_GUARD',
    }, 403);
  }

  // Phase 4 — Ensure icon exists
  const iconExists = await env.WORLD_STATE.prepare(
    `SELECT id FROM indus_icons WHERE icon_id = ?`
  ).bind(indus_icon).first();

  if (!iconExists) {
    await env.WORLD_STATE.prepare(
      `INSERT INTO indus_icons (icon_id, icon_type, ontological_state) VALUES (?, 'SUBJECT', 'ACTIVE')`
    ).bind(indus_icon).run();
  }

  // Phase 5 — Inject context droplet into TEMA Core
  const dropletId    = `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const initialEigen = compatible ? 0.7 : 0.4;
  const infoEntropy  = calculateEntropy(latin_root, glyph.operator_class);

  await env.TEMA_SUBSTRATE.prepare(`
    INSERT INTO context_droplets
      (droplet_id, content, latin_root, hebrew_glyph, indus_icon,
       eigenvalue_weight, information_entropy, layer)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'CORE')
  `).bind(
    dropletId,
    context || `[${latin_root}][${glyph.glyph}][${indus_icon}]`,
    latin_root, glyph.glyph, indus_icon,
    initialEigen, infoEntropy
  ).run();

  // Phase 6 — EBA
  const ebaResult = await runEBAInternal(env, dropletId);

  // Phase 7 — Myelinate root
  const newMyelination = (root.myelination_count || 0) + 1;
  const newNodeType    = newMyelination >= M_HARD ? 'CORE_NODE' : 'MODULAR_NODE';

  await env.STAMP_REGISTRY.prepare(`
    UPDATE latin_roots SET myelination_count = ?, node_type = ? WHERE root = ?
  `).bind(newMyelination, newNodeType, latin_root).run();

  // Myelinate Nexus valves
  await env.TEMA_SUBSTRATE.prepare(`
    UPDATE nexus_valves
    SET myelination_count = myelination_count + 1,
        transfer_count    = transfer_count + 1,
        last_transfer     = datetime('now')
    WHERE from_layer = 'CORE'
  `).run();

  // Update icon
  await env.WORLD_STATE.prepare(`
    UPDATE indus_icons
    SET ontological_state     = 'ACTIVE',
        myelination_count     = myelination_count + 1,
        eigenvalue_centrality = ?,
        updated_at            = datetime('now')
    WHERE icon_id = ?
  `).bind(initialEigen, indus_icon).run();

  // Record glyph activation
  await env.WORLD_STATE.prepare(`
    INSERT INTO glyph_activations
      (glyph, glyph_name, activation_source, activation_weight, domain_context, icon_id)
    VALUES (?, ?, 'ISA_EXECUTION', ?, ?, ?)
  `).bind(glyph.glyph, glyph.name, initialEigen, root.semantic_vector, indus_icon).run();

  return json({
    status: 'EXECUTED',
    triplet: {
      latin_root,
      hebrew_glyph:  glyph.glyph,
      glyph_name:    glyph.name,
      indus_icon,
    },
    jurisdictional_scope: {
      root_meaning:      root.core_meaning,
      semantic_vector:   root.semantic_vector,
      node_type:         newNodeType,
      myelination_count: newMyelination,
      hardened:          newNodeType === 'CORE_NODE',
    },
    execution: {
      operator_class:        glyph.operator_class,
      traversal_function:    glyph.traversal_function,
      glyph_root_compatible: compatible,
      affinity_rank:         affinityRank,
      compatibility_note: compatible
        ? `Primary affinity confirmed (rank ${affinityRank})`
        : 'Cross-jurisdiction — valid but bridging node recommended',
    },
    tema: {
      droplet_id:         dropletId,
      initial_eigenvalue: initialEigen,
      information_entropy: infoEntropy,
      layer:              ebaResult.droplet_layer,
      eba:                ebaResult,
    },
    kernel_note: buildKernelNote(glyph.operator_class, root.semantic_vector, indus_icon),
  });
}

// ═══════════════════════════════════════════════════════════════
// TEMA
// ═══════════════════════════════════════════════════════════════

async function runEBAInternal(env, newDropletId) {
  const coreDroplets = await env.TEMA_SUBSTRATE.prepare(
    `SELECT * FROM context_droplets WHERE layer = 'CORE' ORDER BY eigenvalue_weight DESC`
  ).all();

  const droplets  = coreDroplets.results;
  const lambdaMax = droplets.length ? droplets[0].eigenvalue_weight : 0;
  const cScope    = lambdaMax > 0 ? Math.min(1.0, 1.0 / lambdaMax) : 1.0;

  let nodesShed = 0, nodesEjected = 0, dampingApplied = 0;

  // Damping
  if (lambdaMax > LAMBDA_CEIL && droplets.length > 1) {
    await env.TEMA_SUBSTRATE.prepare(
      `UPDATE context_droplets SET eigenvalue_weight = eigenvalue_weight * 0.7 WHERE droplet_id = ?`
    ).bind(droplets[0].droplet_id).run();
    dampingApplied = 1;
  }

  // Shed / eject
  for (const d of droplets) {
    if (d.droplet_id === newDropletId) continue;
    if (d.eigenvalue_weight < THETA_SHED) {
      if (d.myelination_score < M_MIN && d.eigenvalue_weight < THETA_DROP) {
        await env.TEMA_SUBSTRATE.prepare(
          `UPDATE context_droplets SET layer = 'FIRMAMENT', migrated_at = datetime('now') WHERE droplet_id = ?`
        ).bind(d.droplet_id).run();
        nodesEjected++;
      } else {
        await env.TEMA_SUBSTRATE.prepare(
          `UPDATE context_droplets SET layer = 'OCEAN', migrated_at = datetime('now') WHERE droplet_id = ?`
        ).bind(d.droplet_id).run();
        await env.TEMA_SUBSTRATE.prepare(`
          INSERT OR IGNORE INTO ocean_droplets
            (droplet_id, content, latin_root, hebrew_glyph, eigenvalue_weight)
          SELECT droplet_id, content, latin_root, hebrew_glyph, eigenvalue_weight
          FROM context_droplets WHERE droplet_id = ?
        `).bind(d.droplet_id).run();
        nodesShed++;
      }
    }
  }

  // Log
  await env.TEMA_SUBSTRATE.prepare(`
    INSERT INTO eba_log
      (lambda_max, lambda_ceiling, c_scope, c_min, nodes_shed, nodes_ejected, damping_applied, trigger)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ISA_EXECUTION')
  `).bind(lambdaMax, LAMBDA_CEIL, cScope, C_MIN, nodesShed, nodesEjected, dampingApplied).run();

  return {
    lambda_max:      lambdaMax,
    c_scope:         cScope,
    nodes_shed:      nodesShed,
    nodes_ejected:   nodesEjected,
    damping_applied: dampingApplied === 1,
    droplet_layer:   'CORE',
  };
}

async function runEBA(env) {
  const result = await runEBAInternal(env, null);
  return json({ status: 'EBA_COMPLETE', ...result });
}

async function getTEMACore(env) {
  const droplets = await env.TEMA_SUBSTRATE.prepare(
    `SELECT * FROM context_droplets WHERE layer = 'CORE' ORDER BY eigenvalue_weight DESC`
  ).all();
  const valves   = await env.TEMA_SUBSTRATE.prepare(`SELECT * FROM nexus_valves`).all();
  const lastEBA  = await env.TEMA_SUBSTRATE.prepare(`SELECT * FROM eba_log ORDER BY id DESC LIMIT 1`).first();

  const lambdaMax = droplets.results.length ? droplets.results[0].eigenvalue_weight : 0;
  const cScope    = lambdaMax > 0 ? Math.min(1.0, 1.0 / lambdaMax) : 1.0;

  return json({
    layer:         'CORE',
    droplet_count: droplets.results.length,
    lambda_max:    lambdaMax,
    c_scope:       cScope,
    scope_health:  cScope > C_MIN ? 'HEALTHY' : 'OSSIFICATION_RISK',
    droplets:      droplets.results,
    nexus_valves:  valves.results,
    last_eba:      lastEBA,
  });
}

async function getTEMAOcean(env) {
  const droplets = await env.TEMA_SUBSTRATE.prepare(
    `SELECT * FROM ocean_droplets ORDER BY circulation_cycles DESC`
  ).all();

  // Circulate
  await env.TEMA_SUBSTRATE.prepare(`
    UPDATE ocean_droplets
    SET circulation_cycles  = circulation_cycles + 1,
        precipitation_score = precipitation_score + (myelination_score * 0.1),
        last_circulation    = datetime('now')
  `).run();

  // Precipitate to Cave
  const toPrecipitate = await env.TEMA_SUBSTRATE.prepare(
    `SELECT * FROM ocean_droplets WHERE circulation_cycles >= ?`
  ).bind(C_PRECIPITATE).all();

  for (const d of toPrecipitate.results) {
    await env.TEMA_SUBSTRATE.prepare(`
      INSERT OR IGNORE INTO cave_stalactites
        (stalactite_id, content, latin_root, hebrew_glyph, stalactite_length, myelination_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      `st_${d.droplet_id}`,
      d.content, d.latin_root, d.hebrew_glyph,
      d.precipitation_score, Math.floor(d.circulation_cycles)
    ).run();
    await env.TEMA_SUBSTRATE.prepare(
      `DELETE FROM ocean_droplets WHERE droplet_id = ?`
    ).bind(d.droplet_id).run();
  }

  return json({
    layer:                'OCEAN',
    droplet_count:        droplets.results.length,
    precipitated_to_cave: toPrecipitate.results.length,
    droplets:             droplets.results,
  });
}

async function getTEMACave(env) {
  const stalactites = await env.TEMA_SUBSTRATE.prepare(
    `SELECT * FROM cave_stalactites ORDER BY stalactite_length DESC`
  ).all();
  return json({
    layer:            'CAVE',
    stalactite_count: stalactites.results.length,
    stalactites:      stalactites.results,
    note: 'Retrieval triggered by Core eigenvalue resonance reaching the ceiling',
  });
}

async function getNexusValves(env) {
  const valves = await env.TEMA_SUBSTRATE.prepare(
    `SELECT * FROM nexus_valves ORDER BY myelination_count DESC`
  ).all();
  return json({
    valves: valves.results.map(v => ({
      ...v,
      conductivity_note: v.myelination_count > 5
        ? 'High-myelination — fast conducting'
        : 'Low-myelination — building pathway',
    })),
  });
}

// ═══════════════════════════════════════════════════════════════
// WORLD STATE
// ═══════════════════════════════════════════════════════════════

async function listIcons(env) {
  const icons = await env.WORLD_STATE.prepare(`
    SELECT i.*, COUNT(m.id) as augmentation_count
    FROM indus_icons i
    LEFT JOIN modular_augmentations m ON m.icon_id = i.icon_id AND m.detached_at IS NULL
    GROUP BY i.id
    ORDER BY i.eigenvalue_centrality DESC
  `).all();
  return json({ count: icons.results.length, icons: icons.results });
}

async function getIcon(url, env) {
  const iconId = url.searchParams.get('id');
  if (!iconId) return json({ error: 'Missing ?id= param' }, 400);

  const icon = await env.WORLD_STATE.prepare(
    `SELECT * FROM indus_icons WHERE icon_id = ?`
  ).bind(iconId).first();
  if (!icon) return json({ error: `Icon '${iconId}' not found` }, 404);

  const augmentations = await env.WORLD_STATE.prepare(
    `SELECT * FROM modular_augmentations WHERE icon_id = ? AND detached_at IS NULL`
  ).bind(iconId).all();

  const activations = await env.WORLD_STATE.prepare(
    `SELECT * FROM glyph_activations WHERE icon_id = ? ORDER BY id DESC LIMIT 10`
  ).bind(iconId).all();

  return json({ icon, augmentations: augmentations.results, recent_activations: activations.results });
}

async function recordObservation(body, env) {
  const { domain, observation_type, summary, raw_data, activated_glyphs } = body;
  if (!domain || !observation_type) return json({ error: 'domain and observation_type required' }, 400);

  const domainImpact = { Seismic:0.8, Solar:0.7, Volcanic:0.9, Oceanic:0.5, Atmospheric:0.6, Cosmic:0.4 };
  const eigenImpact  = domainImpact[domain] || 0.5;

  await env.WORLD_STATE.prepare(`
    INSERT INTO domain_observations
      (domain, observation_type, summary, raw_data, activated_glyphs, eigenvalue_impact, changed)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).bind(
    domain, observation_type, summary || '',
    raw_data ? JSON.stringify(raw_data) : null,
    activated_glyphs ? JSON.stringify(activated_glyphs) : null,
    eigenImpact
  ).run();

  if (activated_glyphs && Array.isArray(activated_glyphs)) {
    for (const g of activated_glyphs) {
      await env.WORLD_STATE.prepare(`
        INSERT INTO glyph_activations
          (glyph, glyph_name, activation_source, activation_weight, domain_context)
        VALUES (?, ?, 'WITNESS_OBSERVATION', ?, ?)
      `).bind(g, g, eigenImpact, domain).run();
    }
  }

  const dropletId = `obs_${Date.now()}_${domain.toLowerCase()}`;
  await env.TEMA_SUBSTRATE.prepare(`
    INSERT INTO context_droplets
      (droplet_id, content, latin_root, hebrew_glyph, indus_icon,
       eigenvalue_weight, information_entropy, layer)
    VALUES (?, ?, ?, ?, 'Icon_EarthWitness', ?, ?, 'CORE')
  `).bind(
    dropletId,
    `[OBSERVATION:${domain}] ${summary || observation_type}`,
    domainToRoot(domain), domainToGlyph(domain),
    eigenImpact, calculateEntropy(domain, observation_type)
  ).run();

  return json({ status: 'OBSERVED', domain, eigenvalue_impact: eigenImpact, droplet_id: dropletId });
}

async function listJurisdictions(env) {
  const jurisdictions = await env.WORLD_STATE.prepare(
    `SELECT * FROM emergent_jurisdictions ORDER BY coherence_score DESC`
  ).all();
  return json({
    count: jurisdictions.results.length,
    note: 'Jurisdictions emerge from Latin root node cycles (≥3 nodes).',
    jurisdictions: jurisdictions.results,
  });
}

async function checkJurisdiction(body, env) {
  const { roots } = body;
  if (!roots || !Array.isArray(roots) || roots.length < 3) {
    return json({ error: 'Minimum 3 Latin root nodes required' }, 400);
  }

  const placeholders = roots.map(() => '?').join(',');
  const resolved = await env.STAMP_REGISTRY.prepare(`
    SELECT r.id, r.root, r.core_meaning, r.semantic_vector, r.myelination_count,
           GROUP_CONCAT(g.name) as glyphs,
           GROUP_CONCAT(g.operator_class) as operator_classes
    FROM latin_roots r
    JOIN root_glyph_affinities rga ON r.id = rga.root_id
    JOIN hebrew_glyphs g ON g.id = rga.glyph_id
    WHERE r.root IN (${placeholders})
    GROUP BY r.id
  `).bind(...roots).all();

  const foundRoots = resolved.results.map(r => r.root);
  const missing    = roots.filter(r => !foundRoots.includes(r));
  if (missing.length) return json({ error: `Unknown roots: ${missing.join(', ')}` }, 422);

  const operatorClasses = new Set();
  resolved.results.forEach(r => r.operator_classes.split(',').forEach(oc => operatorClasses.add(oc)));

  const hasConflict = operatorClasses.has('PERCEPTION')
    && operatorClasses.has('STRUCTURAL')
    && !operatorClasses.has('COGNITIVE');

  const glyphCount = {};
  resolved.results.forEach(r => r.glyphs.split(',').forEach(g => {
    glyphCount[g] = (glyphCount[g] || 0) + 1;
  }));
  const dominantGlyph = Object.entries(glyphCount).sort((a,b) => b[1]-a[1])[0];

  const avgMyelination = resolved.results.reduce((s,r) => s + (r.myelination_count||0), 0) / resolved.results.length;
  const coherenceScore = Math.min(1.0, (roots.length/10) + (avgMyelination/M_HARD*0.3) + (hasConflict ? -0.2 : 0.1));

  if (!hasConflict) {
    const hash = [...roots].sort().join('_');
    await env.WORLD_STATE.prepare(`
      INSERT OR REPLACE INTO emergent_jurisdictions
        (jurisdiction_hash, root_nodes, node_count, dominant_glyph,
         dominant_operator_class, coherence_score, stability_score, node_type, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      hash, JSON.stringify(roots), roots.length,
      dominantGlyph ? dominantGlyph[0] : null,
      [...operatorClasses].join(','),
      coherenceScore, avgMyelination / M_HARD,
      avgMyelination >= M_HARD ? 'CORE_NODE' : 'MODULAR_NODE'
    ).run();
  }

  return json({
    valid: !hasConflict,
    jurisdiction: {
      roots: resolved.results.map(r => ({
        root: r.root, meaning: r.core_meaning,
        semantic_vector: r.semantic_vector, myelination: r.myelination_count,
        glyphs: r.glyphs.split(','),
      })),
      node_count:          roots.length,
      dominant_glyph:      dominantGlyph ? dominantGlyph[0] : null,
      operator_classes:    [...operatorClasses],
      coherence_score:     coherenceScore,
      avg_myelination:     avgMyelination,
      planar_dependency:   'SATISFIED',
      glyph_compatibility: hasConflict ? 'BRIDGING_NODE_REQUIRED' : 'COMPATIBLE',
      node_type:           avgMyelination >= M_HARD ? 'CORE_NODE' : 'MODULAR_NODE',
      note: hasConflict
        ? 'PERCEPTION + STRUCTURAL conflict — add COGNITIVE bridging node'
        : 'Valid jurisdiction — written to world state.',
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// SCENE
// ═══════════════════════════════════════════════════════════════

async function getSceneData(env) {
  const [roots, coreDroplets, oceanDroplets, stalactites, icons, jurisdictions, activations] =
    await Promise.all([
      env.STAMP_REGISTRY.prepare(`
        SELECT r.root, r.core_meaning, r.semantic_vector, r.myelination_count, r.node_type,
               g.glyph, g.operator_class
        FROM latin_roots r
        LEFT JOIN root_glyph_affinities rga ON r.id = rga.root_id AND rga.affinity_rank = 1
        LEFT JOIN hebrew_glyphs g ON g.id = rga.glyph_id
        ORDER BY r.myelination_count DESC
      `).all(),
      env.TEMA_SUBSTRATE.prepare(
        `SELECT * FROM context_droplets WHERE layer = 'CORE' ORDER BY eigenvalue_weight DESC LIMIT 20`
      ).all(),
      env.TEMA_SUBSTRATE.prepare(
        `SELECT * FROM ocean_droplets ORDER BY circulation_cycles DESC LIMIT 20`
      ).all(),
      env.TEMA_SUBSTRATE.prepare(
        `SELECT * FROM cave_stalactites ORDER BY stalactite_length DESC LIMIT 10`
      ).all(),
      env.WORLD_STATE.prepare(`SELECT * FROM indus_icons`).all(),
      env.WORLD_STATE.prepare(
        `SELECT * FROM emergent_jurisdictions ORDER BY coherence_score DESC`
      ).all(),
      env.WORLD_STATE.prepare(
        `SELECT glyph, glyph_name, activation_weight, domain_context, activated_at
         FROM glyph_activations ORDER BY id DESC LIMIT 10`
      ).all(),
    ]);

  const phi = Math.PI * (3 - Math.sqrt(5));
  const n   = roots.results.length;

  const latticeNodes = roots.results.map((r, i) => {
    const y      = 1 - (i / Math.max(n-1,1)) * 2;
    const radius = Math.sqrt(1 - y*y);
    const theta  = phi * i;
    const scale  = 3 + (r.myelination_count||0) * 0.1;
    return {
      id:              r.root,
      label:           r.root,
      meaning:         r.core_meaning,
      semantic_vector: r.semantic_vector,
      glyph:           r.glyph,
      operator_class:  r.operator_class,
      myelination:     r.myelination_count,
      node_type:       r.node_type,
      position: {
        x: Math.cos(theta) * radius * scale,
        y: y * scale,
        z: Math.sin(theta) * radius * scale,
      },
      size:       0.1 + (r.myelination_count||0) * 0.02,
      brightness: r.node_type === 'CORE_NODE' ? 1.0 : 0.4 + (r.myelination_count||0) * 0.05,
      color:      operatorClassToColor(r.operator_class),
    };
  });

  return json({
    scene: {
      lattice_nodes:    latticeNodes,
      core_droplets:    coreDroplets.results,
      ocean_droplets:   oceanDroplets.results,
      cave_stalactites: stalactites.results,
      icons:            icons.results,
      jurisdictions:    jurisdictions.results,
      active_glyphs:    activations.results,
    },
    meta: {
      node_count:         latticeNodes.length,
      core_droplet_count: coreDroplets.results.length,
      ocean_count:        oceanDroplets.results.length,
      cave_count:         stalactites.results.length,
      icon_count:         icons.results.length,
    },
    render_hints: {
      lattice:       'Root nodes as spheres. CORE_NODE = full brightness. Fibonacci sphere layout.',
      droplets:      'Core droplets pulse at eigenvalue_weight frequency inside lattice sphere.',
      ocean:         'Ocean droplets orbit in torus at y=2.0, speed = circulation_cycles * 0.01.',
      cave:          'Stalactites hang from y=6.0, length = stalactite_length, downward.',
      nexus:         'Nexus valves are tube connections between lattice sphere and torus.',
      icons:         'Icons are glowing points inside lattice at position_x/y/z.',
      jurisdictions: 'Draw enclosing mesh between jurisdiction root nodes.',
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function calculateEntropy(root, operatorClass) {
  const base   = (root?.length || 3) / 10;
  const classW = { PERCEPTION:0.9, COGNITIVE:0.8, ACTION:0.7, STRUCTURAL:0.6, ONTOLOGICAL:0.5 };
  return Math.min(1.0, base + (classW[operatorClass] || 0.5) * 0.3);
}

function domainToRoot(domain) {
  return { Seismic:'terr', Solar:'luc', Oceanic:'mar', Volcanic:'ign', Atmospheric:'spir', Cosmic:'sol' }[domain] || 'gen';
}

function domainToGlyph(domain) {
  return { Seismic:'ח', Solar:'ש', Oceanic:'מ', Volcanic:'ש', Atmospheric:'ה', Cosmic:'א' }[domain] || 'א';
}

function operatorClassToColor(operatorClass) {
  return {
    PERCEPTION:  '#4fc3f7',
    COGNITIVE:   '#81c784',
    ACTION:      '#ff8a65',
    STRUCTURAL:  '#ce93d8',
    ONTOLOGICAL: '#fff176',
  }[operatorClass] || '#90a4ae';
}

function buildKernelNote(operatorClass, semanticVector, icon) {
  const notes = {
    PERCEPTION:  `${icon} perceives along the ${semanticVector} field`,
    STRUCTURAL:  `${icon} imposes structural constraint in ${semanticVector}`,
    ACTION:      `${icon} executes active transformation in ${semanticVector}`,
    COGNITIVE:   `${icon} performs guided traversal through ${semanticVector}`,
    ONTOLOGICAL: `${icon} modifies the ${semanticVector} graph itself`,
  };
  return notes[operatorClass] || `${icon} executes within ${semanticVector}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}
