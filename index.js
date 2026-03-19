require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const {
  collectAllTrades,
  extractNewTrades,
  buildNewTradesData,
  calcHighPrice,
  getAptType,
  getRecentMonths,
  saveData,
  loadData,
} = require('./collector');

const app = express();
app.use(cors());
app.use(express.json());

const TRADE_KEY    = process.env.TRADE_SERVICE_KEY;    // 국토부 실거래가 키
const BUILDING_KEY = process.env.BUILDING_SERVICE_KEY; // 건축물대장 키
const PORT = process.env.PORT || 4000;

// ── 스케줄: 매일 23시 — 전날 스냅샷 저장 ──────────────────────
cron.schedule('30 0 * * *', async () => {
  console.log('[23시 스냅샷] 저장 시작');
  const data = await collectAllTrades(TRADE_KEY);
  saveData('snapshot_prev.json', data);
  console.log('[23시 스냅샷] 완료');
}, { timezone: 'Asia/Seoul' });

// ── 스케줄: 매일 06시 — 당일 수집 + 신규 거래 추출 ────────────
cron.schedule('0 6 * * *', async () => {
  console.log('[06시 수집] 시작');
  const prev = loadData('snapshot_prev.json');
  const curr = await collectAllTrades(TRADE_KEY);
  saveData('snapshot_curr.json', curr);
  saveData('all_trades.json', curr);

  if (prev) {
    const newTrades = extractNewTrades(prev, curr);
    const newTradesDetail = await buildNewTradesData(newTrades, curr, BUILDING_KEY);
    saveData('new_trades.json', {
      timestamp: new Date().toISOString(),
      trades: newTradesDetail,
    });
    console.log(`[신규거래] ${newTradesDetail.length}건 추출`);
  }
  console.log('[06시 수집] 완료');
}, { timezone: 'Asia/Seoul' });

// ════════════════════════════════════════════
//  REST API
// ════════════════════════════════════════════

// 상태 확인
app.get('/api/status', (req, res) => {
  const curr = loadData('snapshot_curr.json');
  const newT = loadData('new_trades.json');
  res.json({
    lastUpdated: curr?.timestamp || null,
    totalSale:  curr?.sale?.length || 0,
    totalRent:  curr?.rent?.length || 0,
    newTrades:  newT?.trades?.length || 0,
    newTradesUpdated: newT?.timestamp || null,
  });
});

// ── 신규거래 탭 API ────────────────────────────────────────────
app.get('/api/new-trades', (req, res) => {
  const data = loadData('new_trades.json');
  if (!data) return res.json({ trades: [], timestamp: null });

  let trades = [...(data.trades || [])];

  // 매매/전세 필터
  if (req.query.type && req.query.type !== 'all') {
    trades = trades.filter(d => d.type === req.query.type);
  }
  // 타입 필터 (59/84)
  if (req.query.aptType) {
    trades = trades.filter(d => d.타입 === req.query.aptType);
  }

  // 신고가 먼저, 그 다음 거래일 최신순
  trades.sort((a, b) => {
    if (a.신고가 !== b.신고가) return b.신고가 - a.신고가;
    return b.거래일.localeCompare(a.거래일);
  });

  res.json({ trades, timestamp: data.timestamp });
});

// ── 전체거래 탭 API ────────────────────────────────────────────
app.get('/api/all-trades', async (req, res) => {
  const {
    type = 'all',      // 매매 | 전세 | all
    minYear = 0,       // 입주년차 최소
    maxYear = 30,      // 입주년차 최대
    minHhld = 200,     // 세대수 최소
    maxHhld = 9999,    // 세대수 최대
    years = 3,         // 분석기간(년)
    aptType,           // 59 | 84 | 전체
  } = req.query;

  const allData = loadData('all_trades.json');
  if (!allData) return res.json({ trades: [] });

  // 분석기간 기준일
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - parseInt(years));
  const cutoffStr = cutoff.toISOString().slice(0,10);

  let trades = type === '전세'
    ? [...allData.rent]
    : type === '매매'
    ? [...allData.sale]
    : [...allData.sale, ...allData.rent];

  // 타입 필터
  if (aptType && aptType !== 'all') {
    trades = trades.filter(d => d.타입 === aptType);
  }
  // 분석기간 필터
  trades = trades.filter(d => d.거래일 >= cutoffStr);

  // 단지별 59/84타입 각 1개(최고가)만 추출
  const unitMap = {};
  for (const t of trades) {
    const key = `${t.아파트}_${t.법정동}_${t.타입}_${t.type}`;
    const price = t.거래금액 || t.보증금액 || 0;
    if (!unitMap[key] || price > (unitMap[key].거래금액 || unitMap[key].보증금액 || 0)) {
      unitMap[key] = t;
    }
  }

  let result = Object.values(unitMap);

  // 건축물 정보 붙이기 (캐시 활용)
  // (실제 운영시 전처리 단계에서 일괄 처리 권장)

  // 입주년차 필터
  result = result.filter(d => {
    const yr = new Date().getFullYear() - (d.건축년도 || 0);
    return yr >= parseInt(minYear) && yr <= parseInt(maxYear);
  });

  // 거래가 내림차순 정렬
  result.sort((a,b) => (b.거래금액||b.보증금액||0) - (a.거래금액||a.보증금액||0));

  res.json({ trades: result, total: result.length });
});

// ── 수동 수집 트리거 (관리자용) ────────────────────────────────
app.post('/api/collect', async (req, res) => {
  try {
    const data = await collectAllTrades(TRADE_KEY);
    saveData('all_trades.json', data);
    saveData('snapshot_curr.json', data);
    res.json({ success: true, sale: data.sale.length, rent: data.rent.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 서버 시작 ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🏠 인천 실거래가 서버: http://localhost:${PORT}`);
  console.log('📅 스케줄: 매일 23:00 스냅샷, 06:00 수집+신규거래 추출');

  // 데이터 없으면 즉시 수집
  const all = loadData('all_trades.json');
  if (!all) {
    console.log('[초기 수집] 데이터 없음 → 즉시 수집 시작');
    collectAllTrades(TRADE_KEY)
      .then(data => {
        saveData('all_trades.json', data);
        saveData('snapshot_curr.json', data);
        console.log('[초기 수집 완료]', data.sale.length, '건');
      })
      .catch(console.error);
  }
});

// ── 수동 업데이트용 추가 엔드포인트 ──────────────────────────

// 현재 데이터를 prev 스냅샷으로 저장 (비교 기준점)
app.post('/api/snapshot-prev', (req, res) => {
  try {
    const curr = loadData('all_trades.json')
    if (curr) {
      saveData('snapshot_prev.json', curr)
      res.json({ success: true, message: '스냅샷 저장 완료' })
    } else {
      // prev 없으면 빈 데이터로 초기화
      saveData('snapshot_prev.json', { sale: [], rent: [], timestamp: new Date().toISOString() })
      res.json({ success: true, message: '초기 스냅샷 생성' })
    }
  } catch(e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

// 신규 거래 추출 (prev vs curr 비교)
app.post('/api/extract-new', async (req, res) => {
  try {
    const prev = loadData('snapshot_prev.json')
    const curr = loadData('snapshot_curr.json') || loadData('all_trades.json')
    if (!curr) return res.json({ success: false, newCount: 0 })

    const newTrades = extractNewTrades(prev || { sale: [], rent: [] }, curr)
    const newTradesDetail = await buildNewTradesData(newTrades, curr, BUILDING_KEY)

    saveData('new_trades.json', {
      timestamp: new Date().toISOString(),
      trades: newTradesDetail,
    })

    console.log(`[수동 신규거래 추출] ${newTradesDetail.length}건`)
    res.json({ success: true, newCount: newTradesDetail.length })
  } catch(e) {
    res.status(500).json({ success: false, error: e.message })
  }
})
