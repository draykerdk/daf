/* ==========================================================================
 * drayker-mark.js — motor do símbolo Drayker
 * --------------------------------------------------------------------------
 * CONCEITO (leia antes de mexer)
 *
 *   corpo   O planeta. Esfera de raio R=100 no centro do viewBox (-190..190).
 *   aros    NÃO são ornamento: são UMA megaestrutura / nave em órbita,
 *           dois grandes círculos que contêm o vetor de olhar (gaze) e são
 *           inclinados ±tilt em torno dele. Por isso eles sempre se cruzam
 *           na frente do corpo e reorientam com o cursor.
 *   cunha   A sombra que os dois aros projetam cobre exatamente DOIS QUARTOS
 *           opostos do disco do planeta (quadrantes superior e inferior a
 *           partir do ponto de olhar). É a marca. Borda seca, opaca.
 *           Leitura dupla e intencional: proteção (o que está sob a cunha
 *           está blindado) e extração (a estrutura bebe a energia dali).
 *   quartos Tudo que a estrutura "modifica" no planeta é desenhado DENTRO da
 *           cunha, via clip — é o que amarra os dois quartos aos aros.
 *
 * ARQUITETURA
 *   Drayker.vec / Drayker.geom  matemática pura (sem DOM) — reutilize para SVG
 *                               estático, canvas, three.js, o que for.
 *   Drayker.bodies[nome]        {build(ctx), paint(ctx, p)} — o corpo.
 *   Drayker.rings[nome]         {build(ctx), paint(ctx, p)} — a estrutura.
 *   Drayker.wedgeFx[nome]       {build(ctx), paint(ctx, p)} — os dois quartos.
 *   Drayker.create(target, opts) instância viva.
 *   Drayker.toSVGString(opts)    um quadro congelado, para exportar SVG.
 *
 *   Um símbolo = corpo + aros + efeito nos quartos. Combine livremente.
 *   Para criar variação nova NÃO edite o pipeline: registre uma entrada nova
 *   em um dos três registries (veja DRAYKER-MARK.md).
 *
 * p (payload de paint) = { t, gaze:{x,y}, normals:[n1,n2], spans, wedgeD, opts }
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  root.Drayker = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var R = 100;       // raio do corpo
  var VIEW = 190;    // meio-viewBox
  var TAU = Math.PI * 2;
  var f = function (n) { return Math.round(n * 10) / 10; };

  /* ---------------------------------------------------------------- vetores */
  var vec = {
    norm: function (v) { var m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; },
    cross: function (a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    scale: function (v, s) { return [v[0] * s, v[1] * s, v[2] * s]; },
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
    // rotação em torno de Y (usada para girar corpos lentamente)
    rotY: function (v, a) { var c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; },
    // rotação de v em torno de eixo unitário k (Rodrigues)
    rotAxis: function (v, k, a) {
      var c = Math.cos(a), s = Math.sin(a), d = vec.dot(k, v), x = vec.cross(k, v);
      return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
    }
  };
  var norm = vec.norm, cross = vec.cross;

  /* --------------------------------------------------------------- geometria
   * Projeção: ortográfica trivial — (x,y) do vetor 3D já são as coordenadas de
   * tela; z>0 é "na frente" do corpo. Nada de matriz de câmera, de propósito.
   */
  var geom = {
    R: R, VIEW: VIEW,

    /* base ortonormal no plano de normal n */
    basis: function (n) {
      var ref = Math.abs(n[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
      var u = norm(cross(n, ref));
      return [u, cross(n, u)];
    },

    /* Aro de raio rr no plano de n, classificado como no símbolo do site:
     *   over  na frente do corpo (cruza o planeta)   -> desenhar por cima
     *   out   na frente e fora do disco              -> aro cheio
     *   back  atrás do corpo e fora do disco         -> aro esmaecido
     * (atrás E dentro do disco = escondido, não sai em nenhum path) */
    hoop: function (n, rr) {
      var b = geom.basis(n), u = b[0], v = b[1], N = 240, i, t, k;
      var at = function (a) {
        var c = Math.cos(a), s = Math.sin(a);
        return [rr * (u[0] * c + v[0] * s), rr * (u[1] * c + v[1] * s), rr * (u[2] * c + v[2] * s)];
      };
      var kindAt = function (a) {
        var p = at(a), r = Math.hypot(p[0], p[1]);
        return p[2] > 0 ? (r < R ? 'over' : 'out') : (r > R ? 'back' : '');
      };
      /* A troca de classe cai entre duas amostras. Achar o ângulo exato por
       * bissecção é o que tira o degrau onde o aro cruza o limbo do globo. */
      var edge = function (t0, t1, k0) {
        for (var j = 0; j < 24; j++) { var m = (t0 + t1) / 2; if (kindAt(m) === k0) t0 = m; else t1 = m; }
        return (t0 + t1) / 2;
      };
      var runs = [], kind = kindAt(0), start = 0;
      for (i = 1; i <= N; i++) {
        t = i / N * TAU; k = kindAt(t);
        if (k !== kind) {
          var e = edge(t - TAU / N, t, kind);
          runs.push({ k: kind, a: start, b: e });
          kind = k; start = e;
        }
      }
      runs.push({ k: kind, a: start, b: TAU });
      if (runs.length > 1 && runs[0].k === runs[runs.length - 1].k) {
        var last = runs.pop();
        runs[0] = { k: runs[0].k, a: last.a - TAU, b: runs[0].b };
      }
      /* Costura: cada trecho avança um fio além da fronteira. O vizinho é ou a
       * mesma tinta, ou o próprio globo por cima — a emenda nunca aparece. */
      var pad = rr > 0 ? Math.min(0.06, 3.4 / rr) : 0;
      var segs = { over: '', out: '', back: '' };
      runs.forEach(function (rn) {
        if (!rn.k) return;
        var full = rn.b - rn.a >= TAU - 1e-6;
        var a0 = full ? rn.a : rn.a - pad, a1 = full ? rn.b : rn.b + pad;
        var steps = Math.max(2, Math.ceil((a1 - a0) / TAU * N)), d = '';
        for (var j = 0; j <= steps; j++) {
          var p = at(a0 + (a1 - a0) * j / steps);
          d += (j ? 'L ' : 'M ') + f(p[0]) + ' ' + f(p[1]) + ' ';
        }
        segs[rn.k] += d;
      });
      return segs;
    },

    /* Anel cheio (casco largo) entre r1 e r2 no plano de n, partido em
     * frente/atrás do corpo. É o que dá volume de nave ao aro. */
    band: function (n, r1, r2) {
      var b = geom.basis(n), u = b[0], v = b[1], N = 260, out = { front: '', back: '' };
      var run = null, side = 0;
      var flush = function () {
        if (!run || run.o.length < 2) { run = null; return; }
        var d = 'M ' + f(run.o[0][0]) + ' ' + f(run.o[0][1]);
        for (var i = 1; i < run.o.length; i++) d += ' L ' + f(run.o[i][0]) + ' ' + f(run.o[i][1]);
        for (var j = run.i.length - 1; j >= 0; j--) d += ' L ' + f(run.i[j][0]) + ' ' + f(run.i[j][1]);
        out[run.k] += d + ' Z ';
        run = null;
      };
      for (var i2 = 0; i2 <= N; i2++) {
        var t = i2 / N * TAU, c = Math.cos(t), s = Math.sin(t);
        var dx = u[0] * c + v[0] * s, dy = u[1] * c + v[1] * s, dz = u[2] * c + v[2] * s;
        var sd = dz >= 0 ? 1 : -1;
        if (sd !== side) { flush(); side = sd; run = { k: sd > 0 ? 'front' : 'back', o: [], i: [] }; }
        run.o.push([r2 * dx, r2 * dy]);
        run.i.push([r1 * dx, r1 * dy]);
      }
      flush();
      return out;
    },

    /* Ponto sobre o aro: ângulo t no plano de n, raio rr. Útil para pendurar
     * módulos, luzes e feixes na estrutura. */
    onHoop: function (n, rr, t) {
      var b = geom.basis(n), u = b[0], v = b[1], c = Math.cos(t), s = Math.sin(t);
      return [rr * (u[0] * c + v[0] * s), rr * (u[1] * c + v[1] * s), rr * (u[2] * c + v[2] * s)];
    },

    /* Vetor de olhar → normal dos dois planos dos aros.
     * Ambos os planos contêm w, inclinados ±ang em torno dele: é isso que faz
     * os aros se cruzarem sempre na direção de quem olha. */
    gazeNormals: function (gx, gy, ang, count) {
      var wz = Math.sqrt(Math.max(0.25, 1 - gx * gx - gy * gy));
      var w = norm([gx, gy, wz]);
      var u1 = norm([1 - w[0] * w[0], -w[0] * w[1], -w[0] * w[2]]);
      var u2 = cross(w, u1);
      var res = [], k = count || 2;
      for (var i = 0; i < k; i++) {
        var a = k === 3 ? (i * TAU / 3) : (i === 0 ? ang : -ang);
        var v = [Math.cos(a) * u1[0] + Math.sin(a) * u2[0], Math.cos(a) * u1[1] + Math.sin(a) * u2[1], Math.cos(a) * u1[2] + Math.sin(a) * u2[2]];
        res.push(norm(cross(w, v)));
      }
      return res;
    },

    /* A CUNHA. Marcha para fora do ponto de olhar ao longo dos dois planos dos
     * aros, acha onde cada raio cruza a silhueta e costura os cruzamentos em
     * dois quartos opostos. Devolve { d, spans } — spans são os intervalos
     * angulares do limbo cobertos, usados para apagar a atmosfera e para
     * saber ONDE o planeta está sendo modificado. */
    shadowWedge: function (gx, gy, ang, RR) {
      var wz = Math.sqrt(Math.max(0.25, 1 - gx * gx - gy * gy));
      var w = norm([gx, gy, wz]);
      var u1 = norm([1 - w[0] * w[0], -w[0] * w[1], -w[0] * w[2]]);
      var u2 = cross(w, u1);
      var CA = Math.cos(ang), SA = Math.sin(ang);
      var vs = [
        [CA * u1[0] + SA * u2[0], CA * u1[1] + SA * u2[1], CA * u1[2] + SA * u2[2]],
        [CA * u1[0] - SA * u2[0], CA * u1[1] - SA * u2[1], CA * u1[2] - SA * u2[2]]
      ];
      var pt = function (v, t) {
        var c = Math.cos(t), sn = Math.sin(t);
        return [RR * (w[0] * c + v[0] * sn), RR * (w[1] * c + v[1] * sn), RR * (w[2] * c + v[2] * sn)];
      };
      var P = [RR * w[0], RR * w[1]];
      var hit = function (a, b) {
        var lo = 0, hi = 1;
        for (var i = 0; i < 14; i++) {
          var m = (lo + hi) / 2, x = a[0] + (b[0] - a[0]) * m, y = a[1] + (b[1] - a[1]) * m;
          if (Math.hypot(x, y) < R) lo = m; else hi = m;
        }
        return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
      };
      var rays = [];
      for (var ri = 0; ri < 2; ri++) {
        var signs = [1, -1];
        for (var si = 0; si < 2; si++) {
          var sg = signs[si], seq = [], prev = P, end = null;
          for (var k = 1; k <= 140; k++) {
            var p = pt(vs[ri], sg * k * 0.0209);
            if (Math.hypot(p[0], p[1]) >= R) { end = hit(prev, p); break; }
            seq.push([p[0], p[1]]); prev = [p[0], p[1]];
          }
          if (!end) { var mm = Math.hypot(prev[0], prev[1]) || 1; end = [prev[0] / mm * R, prev[1] / mm * R]; }
          rays.push({ sg: sg, seq: seq, end: end, psi: Math.atan2(end[1], end[0]) });
        }
      }
      rays.sort(function (a, b) { return a.psi - b.psi; });
      var inArc = function (from, to, q) {
        var sp = to - from; if (sp < 0) sp += TAU;
        var dq = q - from; if (dq < 0) dq += TAU;
        return dq <= sp;
      };
      var dark = [];
      for (var i2 = 0; i2 < 4; i2++) {
        var a2 = rays[i2], b2 = rays[(i2 + 1) % 4];
        if (inArc(a2.psi, b2.psi, -Math.PI / 2) || inArc(a2.psi, b2.psi, Math.PI / 2)) dark.push(i2);
      }
      var useTB = dark.length === 2 && (dark[1] - dark[0]) % 2 === 0;
      var d = '', spans = [];
      for (var i3 = 0; i3 < 4; i3++) {
        var a = rays[i3], b = rays[(i3 + 1) % 4];
        if (useTB ? dark.indexOf(i3) < 0 : a.sg === b.sg) continue;
        var span = b.psi - a.psi; if (span < 0) span += TAU;
        spans.push({ a: a.psi, b: b.psi });
        d += 'M ' + f(P[0]) + ' ' + f(P[1]) + ' ';
        for (var j = 0; j < a.seq.length; j++) d += 'L ' + f(a.seq[j][0]) + ' ' + f(a.seq[j][1]) + ' ';
        d += 'L ' + f(a.end[0]) + ' ' + f(a.end[1]) + ' A ' + R + ' ' + R + ' 0 ' + (span > Math.PI ? 1 : 0) + ' 1 ' + f(b.end[0]) + ' ' + f(b.end[1]) + ' ';
        for (var k2 = b.seq.length - 1; k2 >= 0; k2--) d += 'L ' + f(b.seq[k2][0]) + ' ' + f(b.seq[k2][1]) + ' ';
        d += 'Z ';
      }
      return { d: d, spans: spans, apex: P };
    },

    /* Setores de anel sobre os spans: apaga o brilho de limbo atrás da cunha
     * (a sombra atravessa a atmosfera). */
    limbBlock: function (spans, r1, r2) {
      var d = '';
      for (var i = 0; i < spans.length; i++) {
        var a = spans[i].a, b = spans[i].b, span = b - a;
        if (span < 0) span += TAU;
        var lf = span > Math.PI ? 1 : 0;
        d += 'M ' + f(r1 * Math.cos(a)) + ' ' + f(r1 * Math.sin(a)) +
          ' A ' + r1 + ' ' + r1 + ' 0 ' + lf + ' 1 ' + f(r1 * Math.cos(b)) + ' ' + f(r1 * Math.sin(b)) +
          ' L ' + f(r2 * Math.cos(b)) + ' ' + f(r2 * Math.sin(b)) +
          ' A ' + r2 + ' ' + r2 + ' 0 ' + lf + ' 0 ' + f(r2 * Math.cos(a)) + ' ' + f(r2 * Math.sin(a)) + ' Z ';
      }
      return d;
    },

    /* Lado noturno visível: arco do terminador fechado ao longo do limbo. */
    night: function (gx, gy) {
      var s = Math.hypot(gx, gy);
      if (s < 0.02) return '';
      var lz = Math.sqrt(Math.max(0.2, 1 - gx * gx - gy * gy));
      var l = norm([gx, gy, lz]);
      var e1 = [-gy / s, gx / s, 0], e2 = cross(l, e1);
      var pts = [], N = 160, i;
      for (i = 0; i < N; i++) {
        var t = i / N * TAU, c = Math.cos(t), sn = Math.sin(t);
        pts.push([R * (e1[0] * c + e2[0] * sn), R * (e1[1] * c + e2[1] * sn), R * (e1[2] * c + e2[2] * sn)]);
      }
      var started = -1;
      for (i = 0; i < N; i++) if (pts[i][2] < 0 && pts[(i + 1) % N][2] >= 0) { started = (i + 1) % N; break; }
      if (started < 0) started = 0;
      var vis = [];
      for (i = 0; i < N; i++) { var p = pts[(started + i) % N]; if (p[2] < 0) break; vis.push(p); }
      if (vis.length < 3) return '';
      var A = vis[0], B = vis[vis.length - 1];
      var d = 'M ' + f(A[0]) + ' ' + f(A[1]);
      for (i = 1; i < vis.length; i++) d += ' L ' + f(vis[i][0]) + ' ' + f(vis[i][1]);
      var angB = Math.atan2(B[1], B[0]), angA = Math.atan2(A[1], A[0]), anti = Math.atan2(-gy, -gx);
      var inSpan = function (from, to, q) {
        var sp = to - from; if (sp < 0) sp += TAU;
        var dq = q - from; if (dq < 0) dq += TAU;
        return dq <= sp;
      };
      var fwd = inSpan(angB, angA, anti);
      var span = angA - angB; if (span < 0) span += TAU;
      for (i = 1; i <= 48; i++) {
        var ang = fwd ? angB + span * (i / 48) : angB - (TAU - span) * (i / 48);
        d += ' L ' + f(R * Math.cos(ang)) + ' ' + f(R * Math.sin(ang));
      }
      return d + ' Z';
    },

    /* Círculo qualquer sobre a esfera (paralelo, círculo máximo deslocado):
     * centro em axis*R*sin(lat), raio R*cos(lat). Só a parte visível (z>0). */
    smallCircle: function (axis, lat, rad) {
      var b = geom.basis(axis), u = b[0], v = b[1];
      var rr = (rad || R) * Math.cos(lat), off = (rad || R) * Math.sin(lat), N = 120;
      var d = '', open = false;
      for (var i = 0; i <= N; i++) {
        var t = i / N * TAU, c = Math.cos(t), s = Math.sin(t);
        var p = [rr * (u[0] * c + v[0] * s) + axis[0] * off, rr * (u[1] * c + v[1] * s) + axis[1] * off, rr * (u[2] * c + v[2] * s) + axis[2] * off];
        if (p[2] > 0) { d += (open ? ' L ' : ' M ') + f(p[0]) + ' ' + f(p[1]); open = true; }
        else open = false;
      }
      return d;
    },

    /* Icosaedro subdividido e projetado — corpo geodésico. */
    icosa: function (sub) {
      var t = (1 + Math.sqrt(5)) / 2;
      var v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
      var faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      for (var s = 0; s < (sub || 0); s++) {
        var nf = [], cache = {};
        var mid = function (a, b) {
          var k = Math.min(a, b) + '_' + Math.max(a, b);
          if (cache[k] != null) return cache[k];
          v.push(norm([v[a][0] + v[b][0], v[a][1] + v[b][1], v[a][2] + v[b][2]]));
          cache[k] = v.length - 1;
          return v.length - 1;
        };
        for (var fi = 0; fi < faces.length; fi++) {
          var fc = faces[fi], a1 = mid(fc[0], fc[1]), b1 = mid(fc[1], fc[2]), c1 = mid(fc[2], fc[0]);
          nf.push([fc[0], a1, c1], [a1, fc[1], b1], [c1, b1, fc[2]], [a1, b1, c1]);
        }
        faces = nf;
      }
      return { verts: v, faces: faces };
    }
  };

  /* ------------------------------------------------------------------ paleta
   * Tokens do site. Toda variação deve sair daqui — não invente cor nova. */
  var palette = {
    ink: '#08080A', panel: '#0C0C0F', line: '#18181E',
    text: '#EDECF0', mute: '#8585A0',
    accent: '#FF5500', accentHot: '#FF8A38',
    chrome: [['0', '#F2F2F8'], ['0.35', '#B9B9CC'], ['0.62', '#6E6E86'], ['1', '#33334A']],
    hullDark: [['0', '#9AA3B4'], ['0.4', '#5A6273'], ['0.75', '#33394A'], ['1', '#171B26']],
    spheres: {
      brand: [['0', '#FF7A2E'], ['0.5', '#C43C00'], ['1', '#3D1200']],
      slate: [['0', '#2A2A36'], ['0.5', '#14141C'], ['1', '#040406']],
      ice:   [['0', '#22485E'], ['0.5', '#102431'], ['1', '#03080B']],
      moss:  [['0', '#1A3A20'], ['0.45', '#0C2012'], ['1', '#030805']],
      star:  [['0', '#FFF0C4'], ['0.45', '#FFB03A'], ['1', '#8C2A00']],
      void:  [['0', '#0A0A10'], ['0.6', '#05050A'], ['1', '#000000']]
    }
  };

  /* -------------------------------------------------------------- utilidades */
  var uidN = 0;
  function mk(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var a in attrs || {}) n.setAttribute(a, attrs[a]);
    return n;
  }
  function gradient(defs, id, type, box, stops) {
    var g = mk(type === 'l' ? 'linearGradient' : 'radialGradient', Object.assign({ id: id, gradientUnits: 'userSpaceOnUse' }, box));
    stops.forEach(function (s) {
      g.appendChild(mk('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] == null ? 1 : s[2] }));
    });
    defs.appendChild(g);
    return 'url(#' + id + ')';
  }

  /* ------------------------------------------------------------------ CORPOS */
  var bodies = {
    /* esfera lisa da marca — o caso base */
    plain: { sphere: 'brand', build: function () { return {}; }, paint: function () { } },

    /* meridianos e paralelos: planeta medido */
    grid: {
      sphere: 'ice',
      build: function (ctx) { return { g: ctx.layers.body.appendChild(mk('path', { fill: 'none', stroke: ctx.accent, 'stroke-opacity': 0.5, 'stroke-width': 1 })) }; },
      paint: function (ctx, p) {
        var ax = norm([0.18, 1, 0.1]), d = '', i;
        for (i = -2; i <= 2; i++) d += geom.smallCircle(ax, i * 0.4, R * 0.995);
        for (i = 0; i < 6; i++) {
          var n = vec.rotAxis(geom.basis(ax)[0], ax, i * Math.PI / 6 + p.t * 0.06);
          d += geom.hoop(n, R * 0.995).over;
        }
        ctx.body.g.setAttribute('d', d);
      }
    },

    /* casca geodésica: a mesma face vinte vezes, sem eixo privilegiado */
    geo: {
      sphere: 'moss',
      build: function (ctx) {
        return {
          mesh: ctx.layers.body.appendChild(mk('path', { fill: 'none', stroke: ctx.accent, 'stroke-opacity': 0.55, 'stroke-width': 0.9, 'stroke-linejoin': 'round' })),
          core: ctx.layers.body.appendChild(mk('circle', { r: 12, fill: '#FFFFFF', opacity: 0.9, filter: ctx.blurSoft }))
        };
      },
      paint: function (ctx, p) {
        var ic = geom.icosa(1), a = p.t * 0.07, d = '';
        var vs = ic.verts.map(function (v) { return vec.scale(vec.rotY(vec.rotAxis(v, [0, 1, 0], a), 0.2), R * 0.99); });
        ic.faces.forEach(function (fc) {
          if (vs[fc[0]][2] + vs[fc[1]][2] + vs[fc[2]][2] < 0) return;
          d += 'M ' + f(vs[fc[0]][0]) + ' ' + f(vs[fc[0]][1]) + ' L ' + f(vs[fc[1]][0]) + ' ' + f(vs[fc[1]][1]) + ' L ' + f(vs[fc[2]][0]) + ' ' + f(vs[fc[2]][1]) + ' Z ';
        });
        ctx.body.mesh.setAttribute('d', d);
        ctx.body.core.setAttribute('r', f(11 + Math.sin(p.t * 0.9) * 1.5));
      }
    },

    /* trança de dois sentidos: estrutura tecida, não desenhada */
    weave: {
      sphere: 'slate',
      build: function (ctx) { return { g: ctx.layers.body.appendChild(mk('path', { fill: 'none', stroke: ctx.accent, 'stroke-opacity': 0.42, 'stroke-width': 1.1 })) }; },
      paint: function (ctx, p) {
        var d = '', ax = [0, 1, 0], b = geom.basis(ax)[0];
        for (var s = -1; s <= 1; s += 2) {
          for (var i = 0; i < 7; i++) {
            var n = vec.rotAxis(vec.rotAxis(b, ax, i * TAU / 7 + s * p.t * 0.05), [0, 0, 1], s * 0.62);
            d += geom.hoop(norm(n), R * 0.99).over;
          }
        }
        ctx.body.g.setAttribute('d', d);
      }
    },

    /* estrela: plumas radiais — o caso em que a cunha lê como captação */
    star: {
      sphere: 'star', hotLimb: true,
      build: function (ctx) {
        var g = ctx.layers.body.appendChild(mk('g', { fill: 'none', stroke: '#FFD98A', 'stroke-opacity': 0.5, 'stroke-width': 1.4 }));
        var arr = [];
        for (var i = 0; i < 40; i++) arr.push(g.appendChild(mk('path', { d: '' })));
        return { arr: arr };
      },
      paint: function (ctx, p) {
        ctx.body.arr.forEach(function (el, i) {
          var a = i / 40 * TAU, r0 = R * 0.55, r1 = R * (0.9 + Math.sin(p.t * 1.6 + i) * 0.08);
          el.setAttribute('d', 'M ' + f(Math.cos(a) * r0) + ' ' + f(Math.sin(a) * r0) + ' L ' + f(Math.cos(a) * r1) + ' ' + f(Math.sin(a) * r1));
        });
      }
    },

    /* horizonte de eventos: corpo negro com anel de fóton */
    voidBody: {
      sphere: 'void',
      build: function (ctx) {
        return { ring: ctx.layers.body.appendChild(mk('circle', { r: R * 0.99, fill: 'none', stroke: '#FFE7BC', 'stroke-width': 2, opacity: 0.8 })) };
      },
      paint: function () { }
    }
  };

  /* -------------------------------------------------------- AROS / ESTRUTURA
   * Cada estilo recebe as duas normais e desenha: peças atrás do corpo
   * (layers.back), peças na frente (layers.front) e o traço que passa por
   * cima do corpo (layers.over). Raio padrão da estrutura: opts.ringRadius. */
  var rings = {
    /* fita única de cromo — o símbolo base do site */
    hairline: {
      build: function (ctx) {
        return {
          back: ctx.layers.back.appendChild(mk('path', { fill: 'none', stroke: ctx.metal, 'stroke-width': 2.6, opacity: 0.3, 'stroke-linecap': 'round' })),
          over: ctx.layers.front.appendChild(mk('path', { fill: 'none', stroke: '#FFE8D0', 'stroke-opacity': 0.16, 'stroke-width': 2, 'stroke-linecap': 'round' })),
          out: ctx.layers.front.appendChild(mk('path', { fill: 'none', stroke: ctx.metal, 'stroke-width': 2.6, 'stroke-linecap': 'round' }))
        };
      },
      paint: function (ctx, p) {
        var o = '', a = '', b = '';
        p.normals.forEach(function (n) { var h = geom.hoop(n, ctx.opts.ringRadius); o += h.over + ' '; a += h.out + ' '; b += h.back + ' '; });
        ctx.ring.over.setAttribute('d', o); ctx.ring.out.setAttribute('d', a); ctx.ring.back.setAttribute('d', b);
      }
    },

    /* NAVE-ANEL: casco largo, costuras de segmento, vigas radiais, módulos e
     * luzes de navegação. A leitura pretendida é megaestrutura habitada. */
    hull: {
      wedgePad: 6,
      build: function (ctx) {
        var L = ctx.layers;
        return {
          bandBack: L.back.appendChild(mk('path', { fill: ctx.hull, opacity: 0.34 })),
          bandFront: L.front.appendChild(mk('path', { fill: ctx.hull, stroke: '#EDECF0', 'stroke-width': 0.7, 'stroke-opacity': 0.45 })),
          seams: L.front.appendChild(mk('path', { fill: 'none', stroke: '#0B0B10', 'stroke-opacity': 0.55, 'stroke-width': 1 })),
          spars: L.front.appendChild(mk('path', { fill: 'none', stroke: '#C9CEDC', 'stroke-width': 1.6, 'stroke-opacity': 0.8 })),
          rail: L.front.appendChild(mk('path', { fill: 'none', stroke: ctx.metal, 'stroke-width': 1.2, 'stroke-opacity': 0.9 })),
          lights: L.front.appendChild(mk('g', { fill: ctx.accent }))
        };
      },
      paint: function (ctx, p) {
        var r1 = ctx.opts.ringRadius - 8, r2 = ctx.opts.ringRadius + 10;
        var fr = '', bc = '', seams = '', spars = '', rail = '', lights = [];
        p.normals.forEach(function (n, qi) {
          var bd = geom.band(n, r1, r2); fr += bd.front; bc += bd.back;
          rail += geom.hoop(n, r2).out + ' ' + geom.hoop(n, r1).out + ' ';
          for (var i = 0; i < 22; i++) {
            var t = p.t * 0.08 + i * TAU / 22 + qi * 0.3;
            var a = geom.onHoop(n, r1, t), b = geom.onHoop(n, r2, t);
            if (a[2] < 0) continue;
            if (i % 3 === 0) spars += 'M ' + f(a[0]) + ' ' + f(a[1]) + ' L ' + f(b[0]) + ' ' + f(b[1]) + ' ';
            seams += 'M ' + f(a[0]) + ' ' + f(a[1]) + ' L ' + f(b[0]) + ' ' + f(b[1]) + ' ';
            if (i % 7 === 0) lights.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.t * 2.2 + i))]);
          }
        });
        ctx.ring.bandFront.setAttribute('d', fr);
        ctx.ring.bandBack.setAttribute('d', bc);
        ctx.ring.seams.setAttribute('d', seams);
        ctx.ring.spars.setAttribute('d', spars);
        ctx.ring.rail.setAttribute('d', rail);
        syncDots(ctx.ring.lights, lights, 1.7);
      }
    },

    /* COLETOR: casco escuro de painéis, com bocas de captação viradas para o
     * planeta. Combine com wedgeFx 'extract'. */
    collector: {
      wedgePad: 5,
      build: function (ctx) {
        var L = ctx.layers;
        return {
          bandBack: L.back.appendChild(mk('path', { fill: '#1B2130', opacity: 0.4 })),
          bandFront: L.front.appendChild(mk('path', { fill: '#232B3C', stroke: '#6C86A8', 'stroke-width': 0.8, 'stroke-opacity': 0.55 })),
          panels: L.front.appendChild(mk('path', { fill: 'none', stroke: '#5F7794', 'stroke-width': 0.9, 'stroke-opacity': 0.7 })),
          rail: L.front.appendChild(mk('path', { fill: 'none', stroke: ctx.metal, 'stroke-width': 1.4 })),
          mouths: L.front.appendChild(mk('g', { fill: ctx.accent, opacity: 0.95 }))
        };
      },
      paint: function (ctx, p) {
        var r1 = ctx.opts.ringRadius - 10, r2 = ctx.opts.ringRadius + 12;
        var fr = '', bc = '', pan = '', rail = '', mouths = [];
        p.normals.forEach(function (n, qi) {
          var bd = geom.band(n, r1, r2); fr += bd.front; bc += bd.back;
          rail += geom.hoop(n, r2).out + ' ';
          for (var i = 0; i < 30; i++) {
            var t = i * TAU / 30 + qi * 0.2, a = geom.onHoop(n, r1, t), b = geom.onHoop(n, r2, t);
            if (a[2] < 0) continue;
            pan += 'M ' + f(a[0]) + ' ' + f(a[1]) + ' L ' + f(b[0]) + ' ' + f(b[1]) + ' ';
            if (i % 10 === 0) mouths.push([a[0], a[1], 0.5 + 0.5 * Math.sin(p.t * 1.4 + i)]);
          }
        });
        ctx.ring.bandFront.setAttribute('d', fr);
        ctx.ring.bandBack.setAttribute('d', bc);
        ctx.ring.panels.setAttribute('d', pan);
        ctx.ring.rail.setAttribute('d', rail);
        syncDots(ctx.ring.mouths, mouths, 2.4);
      }
    },

    /* ESCUDO: dois aros finos com emissores. A cunha aqui é blindagem —
     * combine com wedgeFx 'shield'. */
    shieldRing: {
      build: function (ctx) {
        var L = ctx.layers;
        return {
          back: L.back.appendChild(mk('path', { fill: 'none', stroke: ctx.metal, 'stroke-width': 2, opacity: 0.28 })),
          out: L.front.appendChild(mk('path', { fill: 'none', stroke: ctx.metal, 'stroke-width': 2.2, 'stroke-linecap': 'round' })),
          inner: L.front.appendChild(mk('path', { fill: 'none', stroke: '#E6E6F2', 'stroke-width': 0.8, 'stroke-opacity': 0.5, 'stroke-dasharray': '2 5' })),
          over: L.front.appendChild(mk('path', { fill: 'none', stroke: '#FFE8D0', 'stroke-opacity': 0.14, 'stroke-width': 1.8 })),
          emit: L.front.appendChild(mk('g', { fill: '#DFF3FF' }))
        };
      },
      paint: function (ctx, p) {
        var rr = ctx.opts.ringRadius, o = '', a = '', b = '', inner = '', dots = [];
        p.normals.forEach(function (n, qi) {
          var h = geom.hoop(n, rr); o += h.over + ' '; a += h.out + ' '; b += h.back + ' ';
          inner += geom.hoop(n, rr - 9).out + ' ';
          for (var i = 0; i < 6; i++) {
            var pt = geom.onHoop(n, rr, p.t * 0.12 + i * TAU / 6 + qi);
            if (pt[2] < 0 && Math.hypot(pt[0], pt[1]) < R) continue;
            dots.push([pt[0], pt[1], pt[2] >= 0 ? 1 : 0.35]);
          }
        });
        ctx.ring.over.setAttribute('d', o); ctx.ring.out.setAttribute('d', a);
        ctx.ring.back.setAttribute('d', b); ctx.ring.inner.setAttribute('d', inner);
        syncDots(ctx.ring.emit, dots, 2.6);
      }
    },

    /* ESTALEIRO: casco com pórticos e naves atracadas correndo pelo trilho. */
    drydock: {
      wedgePad: 6,
      build: function (ctx) {
        var L = ctx.layers;
        return {
          bandBack: L.back.appendChild(mk('path', { fill: ctx.hull, opacity: 0.3 })),
          bandFront: L.front.appendChild(mk('path', { fill: ctx.hull, stroke: '#DDE2EE', 'stroke-width': 0.6, 'stroke-opacity': 0.4 })),
          gantry: L.front.appendChild(mk('path', { fill: 'none', stroke: '#AEB6C8', 'stroke-width': 1.1, 'stroke-opacity': 0.85 })),
          craft: L.front.appendChild(mk('g', { fill: '#F2F4FA' })),
          rail: L.front.appendChild(mk('path', { fill: 'none', stroke: ctx.metal, 'stroke-width': 1.3 }))
        };
      },
      paint: function (ctx, p) {
        var r1 = ctx.opts.ringRadius - 5, r2 = ctx.opts.ringRadius + 7;
        var fr = '', bc = '', gan = '', rail = '', craft = [];
        p.normals.forEach(function (n, qi) {
          var bd = geom.band(n, r1, r2); fr += bd.front; bc += bd.back;
          rail += geom.hoop(n, (r1 + r2) / 2).out + ' ';
          for (var i = 0; i < 12; i++) {
            var t = i * TAU / 12 + qi * 0.5, a = geom.onHoop(n, r1 - 9, t), b = geom.onHoop(n, r2 + 6, t);
            if (a[2] < 0) continue;
            gan += 'M ' + f(a[0]) + ' ' + f(a[1]) + ' L ' + f(b[0]) + ' ' + f(b[1]) + ' ';
          }
          for (var c = 0; c < 4; c++) {
            var pt = geom.onHoop(n, r2 + 4, p.t * 0.22 + c * TAU / 4 + qi * 0.8);
            if (pt[2] < 0 && Math.hypot(pt[0], pt[1]) < R) continue;
            craft.push([pt[0], pt[1], pt[2] >= 0 ? 1 : 0.4]);
          }
        });
        ctx.ring.bandFront.setAttribute('d', fr);
        ctx.ring.bandBack.setAttribute('d', bc);
        ctx.ring.gantry.setAttribute('d', gan);
        ctx.ring.rail.setAttribute('d', rail);
        syncDots(ctx.ring.craft, craft, 2.2);
      }
    },

    /* MONO: a marca minimalista de duas cores. Tudo preto (aros, borda, linhas)
     * sobre o globo colorido. Estático, simétrico, para logo e ícone.
     * opts.weight = espessura do traço; opts.border = false tira a borda. */
    mono: {
      flat: true,
      build: function (ctx) {
        var L = ctx.layers, w = ctx.opts.weight || 5, K = '#000000';
        var r = {
          back: L.back.appendChild(mk('path', { fill: 'none', stroke: K, 'stroke-width': w })),
          out: L.front.appendChild(mk('path', { fill: 'none', stroke: K, 'stroke-width': w })),
          over: L.front.appendChild(mk('path', { fill: 'none', stroke: K, 'stroke-width': w }))
        };
        if (ctx.opts.border !== false) L.front.appendChild(mk('circle', { r: R - w / 2, fill: 'none', stroke: K, 'stroke-width': w }));
        return r;
      },
      paint: function (ctx, p) {
        var o = '', b = '', ov = '';
        p.normals.forEach(function (n) {
          var h = geom.hoop(n, ctx.opts.ringRadius);
          o += h.out + ' '; b += h.back + ' '; ov += h.over + ' ';
        });
        ctx.ring.out.setAttribute('d', o);
        ctx.ring.over.setAttribute('d', ov);
        ctx.ring.back.setAttribute('d', b);
      }
    },

    /* MONO SEM AROS: só o globo, a borda e a cunha. O mínimo absoluto. */
    monoBare: {
      flat: true,
      build: function (ctx) {
        var w = ctx.opts.weight || 5;
        if (ctx.opts.border !== false) ctx.layers.front.appendChild(mk('circle', { r: R - w / 2, fill: 'none', stroke: '#000000', 'stroke-width': w }));
        return {};
      },
      paint: function () { }
    },

    /* SELO: dois traços chapados, sem gradiente nem animação — para favicon,
     * app icon, carimbo, bordado, corte a laser. */
    seal: {
      flat: true,
      build: function (ctx) {
        var L = ctx.layers;
        return {
          back: L.back.appendChild(mk('path', { fill: 'none', stroke: ctx.accent, 'stroke-width': 4.5, opacity: 0.35, 'stroke-linecap': 'butt' })),
          over: L.front.appendChild(mk('path', { fill: 'none', stroke: palette.ink, 'stroke-width': 6, 'stroke-linecap': 'butt' })),
          out: L.front.appendChild(mk('path', { fill: 'none', stroke: palette.text, 'stroke-width': 6, 'stroke-linecap': 'butt' }))
        };
      },
      paint: function (ctx, p) {
        var o = '', b = '', ov = '';
        p.normals.forEach(function (n) {
          var h = geom.hoop(n, ctx.opts.ringRadius);
          o += h.out + ' '; b += h.back + ' '; ov += h.over + ' ';
        });
        ctx.ring.out.setAttribute('d', o);
        ctx.ring.over.setAttribute('d', ov);
        ctx.ring.back.setAttribute('d', b);
      }
    }
  };

  /* ------------------------------------------------- OS DOIS QUARTOS (wedgeFx)
   * Desenhado dentro da cunha, sempre em clip: é o efeito da estrutura sobre
   * o planeta. Recebe p.spans (intervalos angulares do limbo cobertos). */
  var wedgeFx = {
    none: { build: function () { return {}; }, paint: function () { } },

    /* EXTRAÇÃO: linhas de energia correndo do limbo para o ponto de captação,
     * com borda quente onde a matéria está sendo puxada. */
    extract: {
      build: function (ctx) {
        var g = ctx.layers.fx.appendChild(mk('g'));
        return {
          flow: g.appendChild(mk('path', { fill: 'none', stroke: ctx.accent, 'stroke-width': 1.2, 'stroke-opacity': 0.85 })),
          hot: g.appendChild(mk('path', { fill: 'none', stroke: palette.accentHot, 'stroke-width': 3, opacity: 0.5, filter: ctx.blurSoft })),
          core: g.appendChild(mk('circle', { r: 6, fill: palette.accentHot, opacity: 0.9, filter: ctx.blurSoft }))
        };
      },
      paint: function (ctx, p) {
        var apex = p.wedge.apex, flow = '', hot = '';
        p.spans.forEach(function (sp) {
          var span = sp.b - sp.a; if (span < 0) span += TAU;
          for (var i = 0; i <= 9; i++) {
            var ang = sp.a + span * (i / 9);
            var ph = (p.t * 0.35 + i * 0.13) % 1;
            var r0 = R * (0.30 + 0.68 * ph), r1 = r0 + R * 0.16;
            flow += 'M ' + f(apex[0] + (Math.cos(ang) * r0 - apex[0]) * 1) + ' ' + f(apex[1] + (Math.sin(ang) * r0 - apex[1]) * 1) +
              ' L ' + f(Math.cos(ang) * r1) + ' ' + f(Math.sin(ang) * r1) + ' ';
          }
          hot += 'M ' + f(R * 0.97 * Math.cos(sp.a)) + ' ' + f(R * 0.97 * Math.sin(sp.a)) +
            ' A ' + f(R * 0.97) + ' ' + f(R * 0.97) + ' 0 ' + (span > Math.PI ? 1 : 0) + ' 1 ' +
            f(R * 0.97 * Math.cos(sp.b)) + ' ' + f(R * 0.97 * Math.sin(sp.b)) + ' ';
        });
        ctx.fx.flow.setAttribute('d', flow);
        ctx.fx.hot.setAttribute('d', hot);
        ctx.fx.core.setAttribute('cx', f(apex[0] * 0.6));
        ctx.fx.core.setAttribute('cy', f(apex[1] * 0.6));
        ctx.fx.core.setAttribute('r', f(5 + Math.sin(p.t * 2) * 1.2));
      }
    },

    /* BLINDAGEM: malha de facetas cobrindo os dois quartos — a sombra como
     * consequência da proteção, não da ausência de luz. */
    shield: {
      build: function (ctx) {
        var g = ctx.layers.fx.appendChild(mk('g'));
        return {
          mesh: g.appendChild(mk('path', { fill: 'none', stroke: '#8FD8FF', 'stroke-width': 0.8, 'stroke-opacity': 0.55 })),
          sweep: g.appendChild(mk('path', { fill: 'none', stroke: '#DFF3FF', 'stroke-width': 2.4, opacity: 0.45, filter: ctx.blurSoft }))
        };
      },
      paint: function (ctx, p) {
        // facetas concêntricas em torno do PONTO DE OLHAR (o eixo da estrutura),
        // não do centro do disco: é a blindagem vista de frente
        var ap = p.wedge.apex, cx = ap[0] * 0.55, cy = ap[1] * 0.55, mesh = '', i;
        var ring = function (r) {
          return 'M ' + f(cx + r) + ' ' + f(cy) + ' A ' + f(r) + ' ' + f(r) + ' 0 1 1 ' + f(cx - r) + ' ' + f(cy) +
            ' A ' + f(r) + ' ' + f(r) + ' 0 1 1 ' + f(cx + r) + ' ' + f(cy) + ' ';
        };
        for (i = 1; i <= 4; i++) mesh += ring(R * (0.3 + i * 0.24));
        for (i = 0; i < 16; i++) {
          var a = i * TAU / 16 + 0.2;
          mesh += 'M ' + f(cx + Math.cos(a) * R * 0.5) + ' ' + f(cy + Math.sin(a) * R * 0.5) +
            ' L ' + f(cx + Math.cos(a) * R * 1.5) + ' ' + f(cy + Math.sin(a) * R * 1.5) + ' ';
        }
        ctx.fx.mesh.setAttribute('d', mesh);
        ctx.fx.sweep.setAttribute('d', ring(R * (0.3 + 0.96 * ((p.t * 0.22) % 1))));
      }
    },

    /* TERRAFORMAÇÃO: os dois quartos ficam visivelmente outra coisa — grade
     * de parcelas e placas acesas onde a estrutura já reescreveu o planeta. */
    terraform: {
      build: function (ctx) {
        var g = ctx.layers.fx.appendChild(mk('g'));
        return {
          plots: g.appendChild(mk('path', { fill: 'none', stroke: '#7CE0A8', 'stroke-width': 0.8, 'stroke-opacity': 0.6 })),
          lit: g.appendChild(mk('g', { fill: '#B8F5D2', opacity: 0.75 }))
        };
      },
      paint: function (ctx, p) {
        var ax = norm([0.2, 1, 0.12]), d = '', i;
        for (i = -3; i <= 3; i++) d += geom.smallCircle(ax, i * 0.28, R * 0.99);
        for (i = 0; i < 12; i++) d += geom.hoop(vec.rotAxis(geom.basis(ax)[0], ax, i * Math.PI / 12 + p.t * 0.04), R * 0.99).over;
        ctx.fx.plots.setAttribute('d', d);
        var dots = [];
        for (i = 0; i < 14; i++) {
          var a = i * 2.399963, rr = R * 0.9 * Math.sqrt(i / 14);
          dots.push([Math.cos(a + p.t * 0.05) * rr, Math.sin(a + p.t * 0.05) * rr, 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(p.t * 1.3 + i))]);
        }
        syncDots(ctx.fx.lit, dots, 1.9);
      }
    }
  };

  /* pool de <circle> reaproveitado — evita criar/destruir nós por quadro */
  function syncDots(g, list, r) {
    while (g.childNodes.length < list.length) g.appendChild(mk('circle', { r: r }));
    for (var i = 0; i < g.childNodes.length; i++) {
      var el = g.childNodes[i];
      if (i < list.length) {
        el.setAttribute('cx', f(list[i][0])); el.setAttribute('cy', f(list[i][1]));
        el.setAttribute('r', r); el.setAttribute('opacity', f(list[i][2] == null ? 1 : list[i][2]));
      } else el.setAttribute('opacity', 0);
    }
  }

  /* -------------------------------------------------------------- olhar (gaze)
   * IMPORTANTE: o olhar é POR MARCA. Cada globo mede o cursor em relação ao
   * SEU próprio centro — é o que faz a estrutura se reorientar de verdade em
   * qualquer ponto da página. (O modelo antigo media tudo em relação a um só
   * elemento: ao rolar a página o vetor saturava e as marcas congelavam.)
   * Sem cursor por 2.4 s, entra uma deriva lenta de repouso. */
  var pointer = { x: null, y: null, t: -9999 };
  var IDLE = 2400;

  function idleGaze(now) {
    var s = (now == null ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) : now) / 1000;
    return { x: Math.sin(s * 0.23) * 0.22 + Math.sin(s * 0.07) * 0.06, y: 0.34 + Math.cos(s * 0.17) * 0.17 };
  }

  /* olhar para um elemento específico, a partir do cursor real */
  function gazeFor(el) {
    var now = performance.now();
    if (pointer.x == null || now - pointer.t > IDLE) return idleGaze(now);
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!r || !r.width) return idleGaze(now);
    var k = r.width * 1.1;
    var gx = (pointer.x - (r.left + r.width / 2)) / k;
    var gy = (pointer.y - (r.top + r.height / 2)) / k;
    var m = Math.hypot(gx, gy);
    if (m > 0.5) { gx = gx / m * 0.5; gy = gy / m * 0.5; }
    return { x: gx, y: gy };
  }

  var gaze = { x: 0, y: 0.42 }; // legado: window.__dkGaze, olhar médio da página

  /* Está na janela? Só faz sentido pintar o que se vê — com dezenas de marcas
   * numa página, pintar as invisíveis é o que trava as visíveis. */
  function visible(el, margin) {
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!r || !r.width) return false;
    var m = margin == null ? 240 : margin;
    return r.bottom > -m && r.top < (window.innerHeight || 0) + m;
  }

  /* olhar suavizado, com o estado guardado no próprio elemento */
  function smoothGaze(el, k) {
    var t = gazeFor(el);
    var s = el.__dkg || (el.__dkg = { x: t.x, y: t.y });
    var a = k == null ? 0.14 : k;
    s.x += (t.x - s.x) * a; s.y += (t.y - s.y) * a;
    return s;
  }
  if (typeof window !== 'undefined') {
    if (window.__dkGaze) gaze = window.__dkGaze; else window.__dkGaze = gaze;
    window.addEventListener('pointermove', function (e) {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = performance.now();
    }, { passive: true });
  }

  var DEFAULTS = {
    body: 'plain',        // Drayker.bodies
    rings: 'hairline',    // Drayker.rings
    wedge: 'none',        // Drayker.wedgeFx
    accent: palette.accent,
    sphere: null,         // sobrepõe bodies[x].sphere: nome em palette.spheres ou array de stops
    tilt: 0.733,          // inclinação dos planos (rad) — 42°, o valor da marca
    ringRadius: 120,
    weight: 5,            // espessura do traço nos estilos chapados (mono)
    border: true,         // borda preta no limbo (mono)
    shadow: 0.94,         // opacidade da cunha (1 = totalmente opaca)
    night: 0.3,
    stars: false,
    animate: true,
    fit: null,            // recorta o viewBox: meia-extensão em múltiplos de R
                          // (1.35 é o certo para ícones pequenos; null = 1.9)
    gaze: null            // {x,y} fixo; null = mede o cursor contra esta marca
  };

  /* ------------------------------------------------------------------ create */
  function create(target, options) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Drayker.create: alvo não encontrado');
    var opts = Object.assign({}, DEFAULTS, options || {});
    var svg = el.tagName && el.tagName.toLowerCase() === 'svg' ? el : el.appendChild(mk('svg'));
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var half = opts.fit ? R * opts.fit : VIEW;
    svg.setAttribute('viewBox', -half + ' ' + -half + ' ' + half * 2 + ' ' + half * 2);
    if (!svg.getAttribute('style')) svg.setAttribute('style', 'width:100%;height:auto;display:block');

    var uid = 'dk' + (++uidN) + '_';
    var defs = svg.appendChild(mk('defs'));
    var bodyDef = bodies[opts.body] || bodies.plain;
    var ringDef = rings[opts.rings] || rings.hairline;
    var fxDef = wedgeFx[opts.wedge] || wedgeFx.none;

    var stops = Array.isArray(opts.sphere) ? opts.sphere : palette.spheres[opts.sphere || bodyDef.sphere || 'brand'];
    // estilo chapado (selo/ícone): cor plana, cunha 100% opaca, sem lado noturno
    if (ringDef.flat) { opts.night = 0; if (!options || options.shadow == null) opts.shadow = 1; }
    var sphereFill = ringDef.flat ? opts.accent : gradient(defs, uid + 'sp', 'r', { cx: -34, cy: -40, r: 176 }, stops);
    var metal = ringDef.flat ? palette.text : gradient(defs, uid + 'mt', 'l', { x1: -130, y1: -130, x2: 130, y2: 130 }, palette.chrome);
    var hull = ringDef.flat ? palette.text : gradient(defs, uid + 'hl', 'l', { x1: -140, y1: -120, x2: 140, y2: 120 }, palette.hullDark);
    var blurSoft = 'url(#' + uid + 'bs)';
    var fl = defs.appendChild(mk('filter', { id: uid + 'bs', x: '-60%', y: '-60%', width: '220%', height: '220%' }));
    fl.appendChild(mk('feGaussianBlur', { stdDeviation: 4 }));

    var clipG = defs.appendChild(mk('clipPath', { id: uid + 'cg' }));
    clipG.appendChild(mk('circle', { r: R }));
    var clipW = defs.appendChild(mk('clipPath', { id: uid + 'cw' }));
    var clipWPath = clipW.appendChild(mk('path', { d: '' }));

    // máscara do limbo: branco em tudo, preto sob a cunha (a sombra atravessa
    // a atmosfera — sem isso o halo denuncia que a cunha é só uma pintura)
    var msk = defs.appendChild(mk('mask', { id: uid + 'mk', maskUnits: 'userSpaceOnUse', x: -VIEW, y: -VIEW, width: VIEW * 2, height: VIEW * 2 }));
    msk.appendChild(mk('rect', { x: -VIEW, y: -VIEW, width: VIEW * 2, height: VIEW * 2, fill: '#FFFFFF' }));
    var maskPath = msk.appendChild(mk('path', { d: '', fill: '#000000' }));

    var layers = {};
    layers.stars = svg.appendChild(mk('g', { fill: '#FFFFFF' }));
    layers.back = svg.appendChild(mk('g'));
    var globe = svg.appendChild(mk('g', { 'clip-path': 'url(#' + uid + 'cg)' }));
    globe.appendChild(mk('circle', { r: R, fill: sphereFill }));
    layers.body = globe.appendChild(mk('g'));
    // ORDEM IMPORTA: a cunha opaca entra ANTES do efeito dos quartos, senão ela
    // cobre o que a estrutura está fazendo com o planeta.
    var wedgeP = globe.appendChild(mk('path', { d: '', fill: ringDef.flat ? '#000000' : '#05050A', 'fill-opacity': opts.shadow }));
    layers.fx = globe.appendChild(mk('g', { 'clip-path': 'url(#' + uid + 'cw)' }));
    var nightP = globe.appendChild(mk('path', { d: '', fill: '#03030A', 'fill-opacity': opts.night }));
    layers.limb = svg.appendChild(mk('g', { mask: 'url(#' + uid + 'mk)' }));
    layers.limb.appendChild(mk('circle', {
      r: R, fill: 'none',
      stroke: bodyDef.hotLimb ? '#FFE6B0' : (ringDef.flat ? 'none' : '#8FC7FF'),
      'stroke-width': bodyDef.hotLimb ? 3 : 1.7, opacity: bodyDef.hotLimb ? 0.55 : 0.75
    }));
    layers.front = svg.appendChild(mk('g'));

    if (opts.stars) for (var i = 0; i < 90; i++) {
      var a = Math.random() * TAU, rr = R * 1.35 + Math.random() * (VIEW - R * 1.35);
      layers.stars.appendChild(mk('circle', { cx: f(Math.cos(a) * rr), cy: f(Math.sin(a) * rr), r: (0.4 + Math.random() * 0.8).toFixed(2), opacity: (0.2 + Math.random() * 0.6).toFixed(2) }));
    }

    var ctx = {
      svg: svg, defs: defs, uid: uid, opts: opts, layers: layers,
      accent: opts.accent, metal: metal, hull: hull, blurSoft: blurSoft,
      mk: mk, geom: geom, vec: vec, palette: palette
    };
    ctx.body = bodyDef.build(ctx);
    ctx.ring = ringDef.build(ctx);
    ctx.fx = fxDef.build(ctx);

    function paint(t) {
      var g = opts.gaze || smoothGaze(svg);
      var normals = geom.gazeNormals(g.x, g.y, opts.tilt);
      var wedgeR = opts.ringRadius + (ringDef.wedgePad || 0);
      var w = geom.shadowWedge(g.x, g.y, opts.tilt, wedgeR);
      var p = { t: t, gaze: g, normals: normals, spans: w.spans, wedge: w, opts: opts };
      wedgeP.setAttribute('d', w.d);
      clipWPath.setAttribute('d', w.d);
      maskPath.setAttribute('d', w.d + geom.limbBlock(w.spans, R * 0.985, VIEW - 1));
      nightP.setAttribute('d', geom.night(g.x * 1.55, g.y * 1.55));
      ringDef.paint(ctx, p);
      bodyDef.paint(ctx, p);
      fxDef.paint(ctx, p);
    }

    var raf = 0, running = false, frame = 0;
    function loop() {
      if (!running) return;
      frame++;
      if (frame % 2 === 0 && (opts.gaze || visible(svg))) { try { paint(performance.now() / 1000); } catch (e) { console.error('Drayker paint', opts.body, opts.rings, e); } }
      raf = requestAnimationFrame(loop);
    }
    paint(0); // primeiro quadro sincronizado: nunca fica em branco (print, aba oculta)
    var prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (opts.animate && !ringDef.flat && !prefersReducedMotion) { running = true; raf = requestAnimationFrame(loop); }

    return {
      svg: svg, ctx: ctx, opts: opts, paint: paint,
      setGaze: function (x, y) { opts.gaze = { x: x, y: y }; paint(performance.now() / 1000); },
      followCursor: function () { opts.gaze = null; },
      stop: function () { running = false; cancelAnimationFrame(raf); },
      start: function () { if (!running) { running = true; raf = requestAnimationFrame(loop); } },
      /* string SVG independente — cole em arquivo .svg, favicon, e-mail, PDF */
      toSVGString: function () {
        var c = svg.cloneNode(true);
        c.setAttribute('xmlns', NS);
        return new XMLSerializer().serializeToString(c);
      }
    };
  }

  /* Um quadro congelado, sem inserir nada na página: para exportar SVG. */
  function toSVGString(options) {
    var host = document.createElementNS(NS, 'svg');
    var inst = create(host, Object.assign({ animate: false, gaze: { x: 0.16, y: 0.34 } }, options || {}));
    return inst.toSVGString();
  }

  /* SVG mono limpo: só as formas que importam (globo, cunha, aros, borda).
   * Sem defs, sem máscara, sem filtro — arquivo pequeno, pronto para .svg,
   * favicon, corte, bordado. Só faz sentido com rings 'mono' / 'monoBare'.
   *
   * mode:
   *   'color'    (padrão) globo colorido + preto
   *   'ink'      uma tinta só: o globo vira o papel, tudo mais é tinta
   *   'knockout' vazado: disco cheio de tinta com a cunha FURADA (evenodd),
   *              para fundo escuro, foto e gravação em negativo
   * ink: a cor da tinta nos modos 'ink' e 'knockout' (default preto/branco). */
  function toMonoSVG(options) {
    var o = Object.assign({ rings: 'mono', accent: palette.accent, gaze: { x: 0, y: 0.34 }, animate: false, fit: 1.5, mode: 'color' }, options || {});
    var host = document.createElementNS(NS, 'svg');
    var inst = create(host, o);
    var w = o.weight || DEFAULTS.weight, half = R * (o.fit || 1.9);
    var vb = -half + ' ' + -half + ' ' + half * 2 + ' ' + half * 2;
    var wedgeEl = host.querySelector('g[clip-path] > path[fill="#000000"]');
    var wedgeD = (o.shadow == null || o.shadow > 0) && wedgeEl ? (wedgeEl.getAttribute('d') || '').trim() : '';
    var disc = 'M -' + R + ' 0 A ' + R + ' ' + R + ' 0 1 0 ' + R + ' 0 A ' + R + ' ' + R + ' 0 1 0 -' + R + ' 0 Z';
    var K = o.mode === 'knockout' ? (o.ink || '#FFFFFF') : (o.ink || '#000000'), out = [];
    /* Duas tintas, uma regra: o ARO é um objeto só e tem uma cor só (K) — na
     * frente, atrás ou cruzando o globo, sempre a mesma. Quem não é aro é a
     * CUNHA: ela é sombra, não tinta de estrutura, e continua preta mesmo no
     * fundo escuro (senão desaparece sobre globo claro). inkOnBody troca isso. */
    var KB = o.mode === 'color' ? (o.inkOnBody || '#000000') : K;

    if (o.mode === 'knockout') {
      out.push('<path fill-rule="evenodd" fill="' + K + '" d="' + disc + (wedgeD ? ' ' + wedgeD : '') + '"/>');
    } else {
      if (o.mode !== 'ink') out.push('<circle r="' + R + '" fill="' + o.accent + '"/>');
      if (wedgeD) out.push('<path d="' + wedgeD + '" fill="' + KB + '"/>');
    }
    /* Ordem: cunha, depois o aro inteiro na mesma tinta, depois a borda. */
    if (inst.ctx.ring.back) ['over', 'back', 'out'].forEach(function (k) {
      var d = inst.ctx.ring[k] && inst.ctx.ring[k].getAttribute('d');
      if (d && d.trim()) out.push('<path d="' + d.trim() + '" fill="none" stroke="' + K + '" stroke-width="' + w + '"/>');
    });
    if (o.border !== false && o.mode !== 'knockout') out.push('<circle r="' + (R - w / 2) + '" fill="none" stroke="' + K + '" stroke-width="' + w + '"/>');
    return '<svg xmlns="' + NS + '" viewBox="' + vb + '" width="512" height="512">\n  ' + out.join('\n  ') + '\n</svg>';
  }

  /* Auto-mount declarativo:
   * <svg data-drayker data-body="geo" data-rings="hull" data-wedge="extract"
   *      data-accent="#FF5500" data-ring-radius="120" data-stars></svg> */
  function mount(scope) {
    var list = (scope || document).querySelectorAll('[data-drayker]');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.__dk) { out.push(el.__dk); continue; }
      var d = el.dataset, o = {};
      if (d.body) o.body = d.body;
      if (d.rings) o.rings = d.rings;
      if (d.wedge) o.wedge = d.wedge;
      if (d.accent) o.accent = d.accent;
      if (d.sphere) o.sphere = d.sphere;
      if (d.tilt) o.tilt = parseFloat(d.tilt);
      if (d.ringRadius) o.ringRadius = parseFloat(d.ringRadius);
      if (d.weight) o.weight = parseFloat(d.weight);
      if (d.border === 'false') o.border = false;
      if (d.shadow != null) o.shadow = parseFloat(d.shadow);
      if (d.fit) o.fit = parseFloat(d.fit);
      if (d.stars != null) o.stars = true;
      if (d.animate === 'false') o.animate = false;
      if (d.gaze) { var g = d.gaze.split(','); o.gaze = { x: parseFloat(g[0]), y: parseFloat(g[1]) }; }
      el.__dk = create(el, o);
      out.push(el.__dk);
    }
    return out;
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(); });
    else mount();
  }

  return {
    R: R, VIEW: VIEW, vec: vec, geom: geom, palette: palette,
    bodies: bodies, rings: rings, wedgeFx: wedgeFx, defaults: DEFAULTS,
    create: create, mount: mount, toSVGString: toSVGString, toMonoSVG: toMonoSVG,
    gazeFor: gazeFor, idleGaze: idleGaze, pointer: pointer, visible: visible, smoothGaze: smoothGaze,
    gaze: gaze, mk: mk, gradient: gradient, syncDots: syncDots
  };
});
