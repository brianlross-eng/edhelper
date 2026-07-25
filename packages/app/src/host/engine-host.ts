import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LineCodec, encodeLine, decodeLine } from './rpc.js';
import { SpanshClient } from './spansh-client.js';
import { fetchCommunityGoals } from './frontier.js';
import { buildCommodityMessage, buildJournalMessage, type TrackedPosition } from './eddn/builders.js';
import { EddnUploader } from './eddn/uploader.js';
import type {
  PlotColonisationRequest,
  PlotExomasteryRequest,
  PlotExplorationRequest,
  PlotFleetCarrierRequest,
  PlotGalaxyRequest,
  PlotNeutronRequest,
  PlotTouristRequest,
  PlotTradeRequest,
  RpcRequest,
  SystemDistancesRequest,
} from '../shared/ipc-types.js';

const SOFTWARE = { softwareName: 'EDHelper', softwareVersion: '0.1.0' };

const spansh = new SpanshClient();
const uploader = new EddnUploader();

let commander = 'unknown';
const tracked: TrackedPosition = { StarSystem: null, StarPos: null, SystemAddress: null };

function send(msg: unknown): void {
  process.stdout.write(encodeLine(msg));
}

let lastSpanshJson = '';
function pushSpanshIfChanged(): void {
  const health = spansh.health;
  const json = JSON.stringify(health);
  if (json !== lastSpanshJson) {
    lastSpanshJson = json;
    send({ event: 'spansh', data: health });
  }
}

uploader.onChange((c) => send({ event: 'eddn', data: c }));

function handleJournalEvent(raw: any, journalDir: string | undefined): void {
  if (raw.event === 'LoadGame' && raw.Commander) commander = String(raw.Commander);
  if ((raw.event === 'FSDJump' || raw.event === 'CarrierJump' || raw.event === 'Location') && raw.StarSystem) {
    tracked.StarSystem = raw.StarSystem;
    tracked.StarPos = raw.StarPos ?? tracked.StarPos;
    tracked.SystemAddress = raw.SystemAddress ?? tracked.SystemAddress;
  }
  const opts = { uploaderID: commander, ...SOFTWARE };
  if (raw.event === 'Market' && journalDir) {
    try {
      const market = JSON.parse(readFileSync(join(journalDir, 'Market.json'), 'utf8'));
      const env = buildCommodityMessage(market, opts);
      if (env) uploader.enqueue(env);
    } catch {
      // Market.json unreadable/not yet written — skip this snapshot.
    }
    return;
  }
  const env = buildJournalMessage(raw, tracked, opts);
  if (env) uploader.enqueue(env);
}

async function handle(req: RpcRequest): Promise<unknown> {
  switch (req.method) {
    case 'ping':
      return 'pong';
    case 'getDataHealth':
      return { spansh: spansh.health, eddn: uploader.counters, journalFile: null };
    case 'plotTrade':
      return spansh.plotTrade(req.params as PlotTradeRequest);
    case 'plotNeutron':
      return spansh.plotNeutron(req.params as PlotNeutronRequest);
    case 'plotExploration':
      return spansh.plotExploration(req.params as PlotExplorationRequest);
    case 'plotFleetCarrier':
      return spansh.plotFleetCarrier(req.params as PlotFleetCarrierRequest);
    case 'plotTourist':
      return spansh.plotTourist(req.params as PlotTouristRequest);
    case 'plotExomastery':
      return spansh.plotExomastery(req.params as PlotExomasteryRequest);
    case 'plotGalaxy':
      return spansh.plotGalaxy(req.params as PlotGalaxyRequest);
    case 'plotColonisation':
      return spansh.plotColonisation(req.params as PlotColonisationRequest);
    case 'systemDistances':
      return spansh.systemDistances(req.params as SystemDistancesRequest);
    case 'communityGoals':
      return fetchCommunityGoals();
    case 'searchSystems':
      return spansh.searchSystems((req.params as { query: string }).query);
    case 'searchStations':
      return spansh.searchStations((req.params as { query: string }).query);
    case 'journalEvent': {
      const p = req.params as { raw: any; journalDir?: string; commander?: string };
      if (p.commander && commander === 'unknown') commander = p.commander;
      handleJournalEvent(p.raw, p.journalDir);
      return true;
    }
    case 'setEddnUpload':
      uploader.setEnabled((req.params as { enabled: boolean }).enabled);
      return uploader.counters;
    default:
      throw new Error(`unknown method: ${req.method}`);
  }
}

const codec = new LineCodec();
process.stdin.on('data', (chunk) => {
  for (const line of codec.push(chunk)) {
    const req = decodeLine<RpcRequest>(line);
    if (!req || typeof req.id !== 'number') continue;
    handle(req)
      .then((result) => send({ id: req.id, ok: true, result }))
      .catch((err) => send({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }))
      .finally(pushSpanshIfChanged);
  }
});
process.stdin.on('end', () => process.exit(0));

send({ event: 'ready', data: { spansh: spansh.health } });
