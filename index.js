import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = "https://portus.puertos.es/portussvr/api";
const BASE_BD = "https://bancodatos.puertos.es/BD/informes";

const BOYAS = {
  "malaga": 1514, "málaga": 1514,
  "tarifa": 1500, "ceuta": 1512, "algeciras": 1504,
  "bilbao": 2136, "vizcaya": 2136,
  "gijon": 1117, "gijón": 1117,
  "cantabria": 2242, "cabo peñas": 2242,
  "estaca de bares": 2244, "villano": 2246, "silleiro": 2248,
  "cadiz": 2342, "cádiz": 2342,
  "gran canaria": 2442, "tenerife": 2446,
  "cabo de gata": 2548, "cabo de palos": 2610,
  "valencia": 2630, "tarragona": 2720,
  "begur": 2798, "dragonera": 2820,
  "mahon": 2838, "mahón": 2838,
  "barcelona": 1731, "pasaia": 1101,
  "alboran": 2542, "alborán": 2542,
  "alicante": 1615, "almeria": 1537, "almería": 1537,
  "melilla": 1560,
};

async function fetchApi(url) {
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function postApi(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function resolverBoya(nombre) {
  const key = nombre.toLowerCase().trim();
  if (BOYAS[key]) return { id: BOYAS[key] };
  for (const [k, id] of Object.entries(BOYAS)) {
    if (k.includes(key) || key.includes(k)) return { id };
  }
  return null;
}

function getValor(datos, col) {
  const p = datos?.find(x => x.nombreColumna === col);
  if (!p || p.averia) return null;
  return parseFloat(p.valor) / p.factor;
}

function parsearDatos(datos) {
  if (!datos) return {};
  const get = (col) => {
    const v = getValor(datos, col);
    const p = datos?.find(x => x.nombreColumna === col);
    return v !== null ? v.toFixed(2) + " " + (p?.unidad || "") : "N/A";
  };
  return {
    oleaje: get("hm0"),
    oleaje_max: get("hmax"),
    periodo_pico: get("tp"),
    periodo_medio: get("tm02"),
    direccion: get("dmd"),
    temperatura: get("Tw"),
    viento_vel: get("Vv"),
    viento_dir: get("Dv"),
    nivel_mar: get("nivel"),
  };
}

const server = new McpServer({ name: "puertos-estado", version: "1.0.0" });

// ─── LISTAR BOYAS ───────────────────────────────────────────────────────────
server.tool("listar_boyas", "Lista boyas de Puertos del Estado",
  { tipo: z.enum(["todas", "activas"]).default("activas") },
  async ({ tipo }) => {
    const data = await fetchApi(BASE + "/estaciones/hist/WAVE?locale=es");
    const boyas = tipo === "activas" ? data.filter(b => b.disponible) : data;
    const lista = boyas.map(b =>
      "[" + b.id + "] " + b.nombre + " — " + (b.incidencia || "Operativa")
    ).join("\n");
    return { content: [{ type: "text", text: "BOYAS (" + boyas.length + "):\n" + lista }] };
  }
);

// ─── INFO BOYA ───────────────────────────────────────────────────────────────
server.tool("info_boya", "Información de una boya: Málaga, Bilbao, Tarifa...",
  { zona: z.string() },
  async ({ zona }) => {
    const data = await fetchApi(BASE + "/estaciones/hist/WAVE?locale=es");
    const matches = data.filter(b => b.nombre.toLowerCase().includes(zona.toLowerCase()));
    if (!matches.length) return { content: [{ type: "text", text: "No encontré " + zona }] };
    const info = matches.map(b =>
      "📍 " + b.nombre + " (ID: " + b.id + ")\n" +
      "   Red: " + b.red.nombre + "\n" +
      "   Posición: " + b.latitud + "N " + b.longitud + "E\n" +
      "   Profundidad: " + b.altitudProfundidad + "m\n" +
      "   Estado: " + (b.incidencia || "Operativa") + "\n" +
      "   Última medida: " + b.maxFechaAna
    ).join("\n\n");
    return { content: [{ type: "text", text: info }] };
  }
);

// ─── DATOS TIEMPO REAL ───────────────────────────────────────────────────────
server.tool("datos_tiempo_real", "Datos actuales de una boya: oleaje, temperatura, viento",
  { zona: z.string().describe("Nombre zona: Málaga, Bilbao, Tarifa, Cantabria...") },
  async ({ zona }) => {
    const boya = resolverBoya(zona);
    if (!boya) return { content: [{ type: "text", text: "No encontré " + zona + ". Zonas disponibles: " + Object.keys(BOYAS).join(", ") }] };
    const data = await postApi(BASE + "/lastData/hist/station/" + boya.id + "?locale=es", ["WAVE"]);
    const d = Array.isArray(data) ? data[0] : data;
    const v = parsearDatos(d?.datos);
    const texto = [
      "📡 DATOS ACTUALES — " + zona.toUpperCase() + " (boya " + boya.id + ")",
      "─────────────────────────────────",
      "📅 Fecha:               " + (d?.fecha ?? "N/A"),
      "🌊 Altura significante: " + v.oleaje,
      "🌊 Altura máxima:       " + v.oleaje_max,
      "🌊 Periodo de pico:     " + v.periodo_pico,
      "🌊 Periodo medio:       " + v.periodo_medio,
      "🧭 Dirección oleaje:    " + v.direccion,
      "🌡️  Temperatura agua:   " + v.temperatura,
      "💨 Viento velocidad:   " + v.viento_vel,
      "💨 Viento dirección:   " + v.viento_dir,
      "📏 Nivel del mar:      " + v.nivel_mar,
      "─────────────────────────────────",
    ].join("\n");
    return { content: [{ type: "text", text: texto }] };
  }
);

// ─── INFORME CLIMÁTICO ───────────────────────────────────────────────────────
server.tool("informe_climatico",
  "Devuelve el enlace al informe PDF de régimen medio o extremal de oleaje de una boya. Contiene estadísticas históricas de décadas de datos.",
  {
    zona: z.string().describe("Nombre de la boya: Bilbao, Cabo de Gata, Valencia..."),
    tipo: z.enum(["medio", "extremal"]).describe("Tipo: 'medio' para régimen medio, 'extremal' para máximos extremos"),
  },
  async ({ zona, tipo }) => {
    const boya = resolverBoya(zona);
    if (!boya) return { content: [{ type: "text", text: "No encontré la boya: " + zona }] };

    const url = tipo === "medio"
      ? `${BASE_BD}/medios/MED_1_2_${boya.id}.pdf`
      : `${BASE_BD}/extremales/EXT_1_2_${boya.id}.pdf`;

    let existe = false;
    try {
      const res = await fetch(url, { method: "HEAD" });
      existe = res.ok;
    } catch {
      existe = false;
    }

    if (!existe) {
      return {
        content: [{
          type: "text",
          text: [
            `⚠️ No se encontró informe de régimen ${tipo} para ${zona} (boya ${boya.id}).`,
            `URL probada: ${url}`,
            ``,
            `Puede que esta boya no tenga informe climático disponible o que el patrón de URL sea diferente.`,
            `Prueba a buscarla manualmente en: https://bancodatos.puertos.es`,
          ].join("\n")
        }]
      };
    }

    return {
      content: [{
        type: "text",
        text: [
          `📊 INFORME CLIMÁTICO — ${zona.toUpperCase()} (boya ${boya.id})`,
          `📋 Tipo: Régimen ${tipo}`,
          ``,
          `🔗 PDF disponible en:`,
          url,
          ``,
          tipo === "medio"
            ? "Contiene estadísticas de régimen medio: histogramas, rosas de oleaje, tablas Hs/Tp y análisis estacional basados en toda la serie histórica de la boya."
            : "Contiene análisis de extremos máximos: niveles de retorno para períodos de 2, 5, 10, 25, 50 y 100 años.",
        ].join("\n")
      }]
    };
  }
);

// ─── INFORMES ANUALES ────────────────────────────────────────────────────────
server.tool("informe_anual",
  "Devuelve el enlace al informe anual de datos de una boya para un año concreto (PDF)",
  {
    zona: z.string().describe("Nombre de la boya"),
    anio: z.number().int().min(1980).max(2025).describe("Año del informe, ej: 2023"),
  },
  async ({ zona, anio }) => {
    const boya = resolverBoya(zona);
    if (!boya) return { content: [{ type: "text", text: "No encontré la boya: " + zona }] };

    const url = `${BASE_BD}/anuales/ANUAL_${boya.id}_${anio}.pdf`;

    let existe = false;
    try {
      const res = await fetch(url, { method: "HEAD" });
      existe = res.ok;
    } catch {
      existe = false;
    }

    if (!existe) {
      return {
        content: [{
          type: "text",
          text: [
            `⚠️ No se encontró informe anual de ${anio} para ${zona} (boya ${boya.id}).`,
            `URL probada: ${url}`,
            ``,
            `Puede que ese año no esté disponible o que el patrón de URL sea diferente.`,
          ].join("\n")
        }]
      };
    }

    return {
      content: [{
        type: "text",
        text: [
          `📅 INFORME ANUAL ${anio} — ${zona.toUpperCase()} (boya ${boya.id})`,
          ``,
          `🔗 PDF disponible en:`,
          url,
          ``,
          `Contiene el resumen anual de datos medidos por la boya durante ${anio}.`,
        ].join("\n")
      }]
    };
  }
);

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
