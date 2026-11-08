import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Activity, ArrowLeft, ArrowRight, ChevronDown, RotateCcw, Settings2, Sparkles, Upload, Zap } from "lucide-react";

type Candidate = { move: string; score: number; depth: number };
type Level = { name: string; skill: number; elo: number; multi: number; blunder: number };
const LEVELS: Level[] = [
  { name: "Sehr schwach", skill: 0, elo: 1320, multi: 5, blunder: 0.68 },
  { name: "Schwach", skill: 2, elo: 1450, multi: 4, blunder: 0.48 },
  { name: "Anfänger", skill: 4, elo: 1600, multi: 3, blunder: 0.30 },
  { name: "Mittelmäßig", skill: 7, elo: 1850, multi: 3, blunder: 0.18 },
  { name: "Fortgeschritten", skill: 11, elo: 2150, multi: 2, blunder: 0.10 },
  { name: "Stark", skill: 15, elo: 2450, multi: 2, blunder: 0.04 },
  { name: "Sehr stark", skill: 18, elo: 2750, multi: 1, blunder: 0.01 },
  { name: "Maximale Stärke", skill: 20, elo: 3190, multi: 1, blunder: 0 }
];
const PIECES: Record<string, string> = {
  wk:"♔", wq:"♕", wr:"♖", wb:"♗", wn:"♘", wp:"♙",
  bk:"♚", bq:"♛", br:"♜", bb:"♝", bn:"♞", bp:"♟"
};
const FILES = "abcdefgh";
const toSquare = (file: number, rank: number) => `${FILES[file]}${rank}` as Square;

export default function App() {
  const gameRef = useRef(new Chess());
  const workerRef = useRef<Worker | null>(null);
  const historyRef = useRef<string[]>([]);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [orientation, setOrientation] = useState<"w" | "b">("w");
  const [myColor, setMyColor] = useState<"w" | "b">("w");
  const [level, setLevel] = useState(3);
  const [showHints, setShowHints] = useState(true);
  const [autoAnalyse, setAutoAnalyse] = useState(true);
  const [thinkingTime, setThinkingTime] = useState(1200);
  const [selected, setSelected] = useState<Square | null>(null);
  const [targets, setTargets] = useState<Square[]>([]);
  const [engineStatus, setEngineStatus] = useState("Engine wird geladen");
  const [engineReady, setEngineReady] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [evalText, setEvalText] = useState("–");
  const [depth, setDepth] = useState(0);
  const [fenInput, setFenInput] = useState("");
  const [showFen, setShowFen] = useState(false);
  const [error, setError] = useState("");
  const [lastMove, setLastMove] = useState<{from: Square; to: Square} | null>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [engineLines, setEngineLines] = useState<string[]>([]);
  const candidatesRef = useRef<Map<number, Candidate>>(new Map());
  const levelRef = useRef(level);
  levelRef.current = level;

  const sync = useCallback(() => {
    setFen(gameRef.current.fen());
    setMoves(gameRef.current.history());
    setSelected(null);
    setTargets([]);
    setCandidate(null);
    setEvalText("–");
    setDepth(0);
    setError("");
  }, []);

  useEffect(() => {
    let alive = true;
    let worker: Worker | null = null;
    fetch(`${import.meta.env.BASE_URL}engine/engine-path.json`)
      .then(r => { if (!r.ok) throw new Error("Engine-Datei fehlt"); return r.json(); })
      .then(data => {
        if (!alive) return;
        worker = new Worker(`${import.meta.env.BASE_URL}engine/${data.file}`);
        workerRef.current = worker;
        worker.onmessage = (event) => {
          const line = String(event.data);
          if (line === "uciok") {
            worker?.postMessage("setoption name Threads value 1");
            worker?.postMessage("setoption name Hash value 64");
            worker?.postMessage("isready");
          }
          if (line === "readyok") {
            setEngineReady(true);
            setEngineStatus("Stockfish bereit");
          }
          if (line.startsWith("info ")) {
            const depthMatch = line.match(/\bdepth (\d+)/);
            const multiMatch = line.match(/\bmultipv (\d+)/);
            const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
            const pvMatch = line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/);
            if (depthMatch && scoreMatch && pvMatch) {
              const d = Number(depthMatch[1]);
              const rank = Number(multiMatch?.[1] || 1);
              let score = Number(scoreMatch[2]) / 100;
              if (scoreMatch[1] === "mate") score = Math.sign(score) * (100 - Math.min(99, Math.abs(score)));
              candidatesRef.current.set(rank, { move: pvMatch[1], score, depth: d });
              setDepth(d);
              setEngineLines([...candidatesRef.current.values()].sort((a,b) => a.score > b.score ? -1 : 1).slice(0,3).map(c => c.move));
              if (rank === 1) setEvalText(score >= 0 ? `+${score.toFixed(1)}` : score.toFixed(1));
            }
          }
          if (line.startsWith("bestmove")) {
            const levelNow = LEVELS[levelRef.current];
            const choices = [...candidatesRef.current.entries()].sort((a,b) => a[0]-b[0]).map(([,v]) => v);
            if (choices.length) {
              const maxRank = Math.min(choices.length, levelNow.multi);
              const pool = choices.slice(0, maxRank);
              const weights = pool.map((_, i) => Math.pow(levelNow.blunder === 0 ? 0.001 : levelNow.blunder, i));
              const total = weights.reduce((a,b) => a+b, 0);
              let roll = Math.random() * total;
              let index = 0;
              for (let i=0;i<weights.length;i++) { roll -= weights[i]; if (roll <= 0) { index=i; break; } }
              setCandidate(pool[index]);
            } else {
              const uci = line.split(" ")[1];
              if (uci && uci !== "(none)") setCandidate({ move: uci, score: 0, depth });
            }
            setAnalysing(false);
            setEngineStatus("Analyse abgeschlossen");
          }
        };
        worker.onerror = () => setEngineStatus("Engine konnte nicht gestartet werden");
        worker.postMessage("uci");
      })
      .catch(() => setEngineStatus("Engine noch nicht installiert – bitte Seite neu laden"));
    return () => { alive = false; worker?.terminate(); workerRef.current = null; };
  }, []);

  const analyse = useCallback(() => {
    const worker = workerRef.current;
    if (!worker || !engineReady || gameRef.current.isGameOver()) return;
    const config = LEVELS[levelRef.current];
    candidatesRef.current.clear();
    setCandidate(null);
    setAnalysing(true);
    setEngineStatus("Stockfish analysiert …");
    worker.postMessage("stop");
    worker.postMessage("ucinewgame");
    worker.postMessage(`setoption name Skill Level value ${config.skill}`);
    worker.postMessage("setoption name UCI_LimitStrength value true");
    worker.postMessage(`setoption name UCI_Elo value ${config.elo}`);
    worker.postMessage(`setoption name MultiPV value ${config.multi}`);
    worker.postMessage(`position fen ${gameRef.current.fen()}`);
    worker.postMessage(`go movetime ${thinkingTime}`);
  }, [engineReady, thinkingTime, level]);

  useEffect(() => {
    if (autoAnalyse && engineReady) {
      const id = window.setTimeout(analyse, 250);
      return () => window.clearTimeout(id);
    }
  }, [fen, autoAnalyse, engineReady, analyse]);

  const legalTargets = useCallback((square: Square) => {
    return gameRef.current.moves({ square, verbose: true }).map(m => m.to as Square);
  }, []);

  const makeMove = useCallback((from: Square, to: Square) => {
    try {
      const move = gameRef.current.move({ from, to, promotion: "q" });
      if (!move) return false;
      historyRef.current.push(move.san);
      setLastMove({ from, to });
      sync();
      return true;
    } catch { return false; }
  }, [sync]);

  const onSquareClick = (square: Square) => {
    if (selected && targets.includes(square)) { makeMove(selected, square); return; }
    const piece = gameRef.current.get(square);
    if (piece) {
      setSelected(square);
      setTargets(legalTargets(square));
    } else {
      setSelected(null);
      setTargets([]);
    }
  };

  const undo = () => {
    const result = gameRef.current.undo();
    if (result) {
      setLastMove(null);
      sync();
    }
  };
  const reset = () => {
    gameRef.current.reset();
    setLastMove(null);
    historyRef.current = [];
    sync();
  };
  const importFen = () => {
    try {
      const next = new Chess(fenInput.trim());
      gameRef.current = next;
      setLastMove(null);
      sync();
      setShowFen(false);
    } catch { setError("Diese FEN-Stellung ist ungültig."); }
  };

  const boardRanks = orientation === "w" ? [8,7,6,5,4,3,2,1] : [1,2,3,4,5,6,7,8];
  const boardFiles = orientation === "w" ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
  const arrow = useMemo(() => {
    if (!showHints || !candidate) return null;
    const uci = candidate.move;
    const from = uci.slice(0,2) as Square, to = uci.slice(2,4) as Square;
    const fx = FILES.indexOf(from[0]), fy = 8 - Number(from[1]);
    const tx = FILES.indexOf(to[0]), ty = 8 - Number(to[1]);
    const x1 = (orientation === "w" ? fx : 7-fx) * 12.5 + 6.25;
    const y1 = (orientation === "w" ? fy : 7-fy) * 12.5 + 6.25;
    const x2 = (orientation === "w" ? tx : 7-tx) * 12.5 + 6.25;
    const y2 = (orientation === "w" ? ty : 7-ty) * 12.5 + 6.25;
    return { x1, y1, x2, y2 };
  }, [candidate, orientation, showHints]);

  const turnLabel = gameRef.current.isGameOver() ? "Partie beendet" : gameRef.current.turn() === "w" ? "Weiß am Zug" : "Schwarz am Zug";
  const gameResult = gameRef.current.isCheckmate() ? (gameRef.current.turn() === "w" ? "Schwarz gewinnt" : "Weiß gewinnt") : gameRef.current.isDraw() ? "Remis" : "";

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark">P</span><span>phinias</span></a>
      <div className="top-status"><span className={engineReady ? "status-dot live" : "status-dot"} />{engineStatus}</div>
      <button className="icon-button" title="Einstellungen" onClick={() => document.getElementById("settings")?.scrollIntoView({behavior:"smooth"})}><Settings2 size={18}/></button>
    </header>
    <div className="workspace">
      <section className="board-section">
        <div className="board-heading">
          <div><span className="eyebrow">ANALYSEBRETT</span><h1>Deine Stellung</h1></div>
          <div className="turn-pill"><span className="turn-dot"/>{turnLabel}</div>
        </div>
        <div className="board-wrap">
          <div className="eval-bar"><div className="eval-black" style={{height:`${Math.max(4,Math.min(96,50-(Number(evalText.replace("+",""))||0)*8))}%`}} /></div>
          <div className="board" role="grid" aria-label="Schachbrett">
            {boardRanks.map((rank, ri) => boardFiles.map((file, fi) => {
              const square = toSquare(file, rank);
              const piece = gameRef.current.get(square);
              const isLight = (file + rank) % 2 === 1;
              const isLast = lastMove?.from === square || lastMove?.to === square;
              return <button key={square} role="gridcell" aria-label={square} draggable={!!piece}
                onDragStart={e => { if (!piece) {e.preventDefault();return;} e.dataTransfer.setData("text/plain", square); setSelected(square); setTargets(legalTargets(square)); }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {e.preventDefault(); const from=e.dataTransfer.getData("text/plain") as Square; if(from) makeMove(from,square);}}
                onClick={() => onSquareClick(square)}
                className={`square ${isLight ? "light" : "dark"} ${selected===square ? "selected" : ""} ${isLast ? "last-move" : ""}`}>
                {fi===0 && <span className="rank-label">{rank}</span>}
                {ri===7 && <span className="file-label">{FILES[file]}</span>}
                {targets.includes(square) && <span className={piece ? "legal-capture" : "legal-dot"} />}
                {piece && <span className={`piece ${piece.color==="w"?"white-piece":"black-piece"}`}>{PIECES[piece.color+piece.type]}</span>}
              </button>;
            }))}
            {arrow && <svg className="move-arrow" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs><marker id="arrowhead" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#35c98a"/></marker></defs>
              <line x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2} stroke="#35c98a" strokeWidth="1.35" strokeLinecap="round" markerEnd="url(#arrowhead)" opacity=".9"/>
            </svg>}
          </div>
        </div>
        <div className="board-actions">
          <button className="secondary-button" onClick={undo} disabled={!moves.length}><ArrowLeft size={16}/> Zurück</button>
          <button className="secondary-button" onClick={reset}><RotateCcw size={15}/> Neue Partie</button>
          <button className="secondary-button" onClick={() => {setFenInput(gameRef.current.fen());setShowFen(v=>!v)}}><Upload size={15}/> FEN</button>
          <button className="secondary-button flip-button" onClick={() => setOrientation(v=>v==="w"?"b":"w")}><ArrowRight size={16}/> Brett drehen</button>
        </div>
        {showFen && <div className="fen-panel"><input value={fenInput} onChange={e=>setFenInput(e.target.value)} placeholder="FEN hier einfügen …"/><button className="primary-button" onClick={importFen}>Laden</button></div>}
        {error && <p className="error-text">{error}</p>}
        {gameResult && <p className="result-text">{gameResult}</p>}
      </section>

      <aside className="side-panel">
        <section className="panel-card engine-card">
          <div className="card-heading"><div className="heading-icon"><Activity size={17}/></div><div><h2>Engine-Analyse</h2><p>Powered by Stockfish</p></div><span className="live-tag">LIVE</span></div>
          <div className="evaluation-row"><div><span className="eyebrow">BEWERTUNG</span><div className="evaluation">{evalText}</div></div><div className="depth-box"><span className="eyebrow">TIEFE</span><strong>{depth || "–"}</strong></div></div>
          <div className="suggestion-box">
            <div className="suggestion-top"><span className="suggestion-label"><Sparkles size={14}/> BESTER ZUG</span>{analysing && <span className="thinking">Denkt nach…</span>}</div>
            <div className="suggestion-move">{candidate ? `${candidate.move.slice(0,2)} → ${candidate.move.slice(2,4)}` : "Noch kein Vorschlag"}</div>
            <p>{candidate ? `Bewertung ${candidate.score >= 0 ? "+" : ""}${candidate.score.toFixed(2)} · Tiefe ${candidate.depth}` : "Starte die Analyse, um einen Zug zu sehen."}</p>
            <button className="primary-button analyze-button" onClick={analyse} disabled={!engineReady || analysing || gameRef.current.isGameOver()}><Zap size={16}/> {analysing ? "Analysiert …" : "Stellung analysieren"}</button>
          </div>
          <div className="toggle-row"><div><strong>Zugvorschlag anzeigen</strong><span>Pfeil auf dem Brett</span></div><button className={`switch ${showHints?"on":""}`} onClick={()=>setShowHints(v=>!v)} aria-label="Zugvorschläge umschalten"><span/></button></div>
          <div className="toggle-row"><div><strong>Automatisch analysieren</strong><span>Nach jedem Zug</span></div><button className={`switch ${autoAnalyse?"on":""}`} onClick={()=>setAutoAnalyse(v=>!v)} aria-label="Automatische Analyse umschalten"><span/></button></div>
        </section>

        <section className="panel-card" id="settings">
          <div className="section-title"><Settings2 size={16}/><h2>Einstellungen</h2></div>
          <div className="setting-block">
            <div className="setting-label"><strong>Spielstärke</strong><span className="level-value">{LEVELS[level].name}</span></div>
            <input className="strength-slider" type="range" min="0" max="7" step="1" value={level} onChange={e=>setLevel(Number(e.target.value))}/>
            <div className="range-labels"><span>Einfach</span><span>Maximal</span></div>
            <div className="level-dots">{LEVELS.map((l,i)=><button key={l.name} className={i===level?"active":""} onClick={()=>setLevel(i)} aria-label={l.name}/>)}</div>
          </div>
          <div className="setting-block">
            <label className="field-label">Deine Farbe</label>
            <div className="segmented"><button className={myColor==="w"?"active":""} onClick={()=>{setMyColor("w");setOrientation("w")}}>Weiß</button><button className={myColor==="b"?"active":""} onClick={()=>{setMyColor("b");setOrientation("b")}}>Schwarz</button></div>
          </div>
          <div className="setting-block">
            <div className="setting-label"><strong>Bedenkzeit</strong><span className="level-value">{(thinkingTime/1000).toFixed(1)} s</span></div>
            <input className="strength-slider" type="range" min="300" max="5000" step="100" value={thinkingTime} onChange={e=>setThinkingTime(Number(e.target.value))}/>
            <div className="range-labels"><span>Schnell</span><span>Gründlich</span></div>
          </div>
        </section>

        <section className="panel-card moves-card">
          <div className="section-title"><Activity size={16}/><h2>Partieverlauf</h2><span className="move-count">{moves.length} Züge</span></div>
          {moves.length ? <div className="move-list">{Array.from({length:Math.ceil(moves.length/2)},(_,i)=><div className="move-pair" key={i}><span>{i+1}.</span><strong>{moves[i*2]}</strong><strong>{moves[i*2+1] || "…"}</strong></div>)}</div> : <div className="empty-moves">Deine Züge erscheinen hier.</div>}
        </section>
        <div className="footer-note"><span className="status-dot live"/> Engine läuft lokal im Browser · Keine Anmeldung nötig</div>
      </aside>
    </div>
  </main>;
}
