const fs = require('fs');
const path = require('path');
const { fetchSale, fetchRent, fetchBuildingInfo } = require('./api');
const { INCHEON_CODES } = require('./regions');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 59㎡ = 약 17.8평, 84㎡ = 약 25.4평
// 타입 판별: 51~66㎡ → 59타입, 75~95㎡ → 84타입
function getAptType(m2) {
  if (m2 >= 51 && m2 <= 66) return '59';
  if (m2 >= 75 && m2 <= 95) return '84';
  return null;
}

// YYYYMM 형식 배열 생성 (최근 N개월)
function getRecentMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return months;
}

// 파일 저장/로드
function saveData(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}
function loadData(filename) {
  const fp = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

// ── 인천 전체 실거래 수집 (3년치) ─────────────────────────────
async function collectAllTrades(serviceKey) {
  console.log('[수집 시작]', new Date().toLocaleString('ko-KR'));
  const months = getRecentMonths(36); // 3년치
  const allSale = [];
  const allRent = [];

  for (const [gu, code] of Object.entries(INCHEON_CODES)) {
    for (const ym of months) {
      const sale = await fetchSale(serviceKey, code, ym);
      const rent = await fetchRent(serviceKey, code, ym);
      sale.forEach(d => { d.구 = gu; d.시도 = '인천광역시'; });
      rent.forEach(d => { d.구 = gu; d.시도 = '인천광역시'; });
      allSale.push(...sale);
      allRent.push(...rent);
      await new Promise(r => setTimeout(r, 150));
    }
    console.log(`  완료: ${gu} (매매 ${allSale.length}건, 전월세 ${allRent.length}건)`);
  }

  // 59/84타입만 필터
  const filteredSale = allSale.filter(d => getAptType(d.전용면적));
  const filteredRent = allRent.filter(d => getAptType(d.전용면적));
  filteredSale.forEach(d => d.타입 = getAptType(d.전용면적));
  filteredRent.forEach(d => d.타입 = getAptType(d.전용면적));

  return { sale: filteredSale, rent: filteredRent, timestamp: new Date().toISOString() };
}

// ── 신규 거래 추출 (전날 23시 vs 오늘 06시 비교) ──────────────
function extractNewTrades(prevData, currData) {
  // 거래 고유키: 아파트+법정동+층+거래일+거래금액
  const makeKey = d => `${d.아파트}_${d.법정동}_${d.층}_${d.거래일}_${d.거래금액||d.보증금액}`;

  const prevKeys = new Set([
    ...(prevData?.sale || []).map(makeKey),
    ...(prevData?.rent || []).map(makeKey),
  ]);

  const newSale = (currData.sale || []).filter(d => !prevKeys.has(makeKey(d)));
  const newRent = (currData.rent || []).filter(d => !prevKeys.has(makeKey(d)));

  return { sale: newSale, rent: newRent };
}

// ── 3년 최고가 계산 ────────────────────────────────────────────
function calcHighPrice(allData, 아파트, 법정동, 타입, excludeDate) {
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const cutoff = threeYearsAgo.toISOString().slice(0,10);

  const trades = allData.filter(d =>
    d.아파트 === 아파트 &&
    d.법정동 === 법정동 &&
    d.타입 === 타입 &&
    d.거래일 >= cutoff &&
    d.거래일 < excludeDate
  );

  if (!trades.length) return null;
  return Math.max(...trades.map(d => d.거래금액 || d.보증금액 || 0));
}

// ── 건축물 정보 캐시 ───────────────────────────────────────────
let buildingCache = {};

async function getBuildingInfo(buildingKey, serviceKey, sigunguCd, bjdongCd, bun, ji) {
  if (buildingCache[buildingKey]) return buildingCache[buildingKey];
  const info = await fetchBuildingInfo(serviceKey, sigunguCd, bjdongCd, bun, ji);
  if (info) buildingCache[buildingKey] = info;
  return info;
}

// ── 신규거래 탭용 데이터 생성 ──────────────────────────────────
// 조건: 준공 10년 이내, 400세대 이상, 59/84타입
async function buildNewTradesData(newTrades, allData, buildingServiceKey) {
  const result = [];
  const all = [...newTrades.sale, ...newTrades.rent];

  for (const trade of all) {
    // 건축물대장 조회
    const sigunguCd = INCHEON_CODES[trade.구] || '';
    const info = await getBuildingInfo(
      `${trade.아파트}_${trade.법정동}`,
      buildingServiceKey,
      sigunguCd.slice(0,5),
      '00000', // bjdongCd는 추가 매핑 필요
      '0000', '0000'
    );

    const 세대수 = info?.세대수 || 0;
    const 준공연도 = info?.준공일 ? parseInt(info.준공일.slice(0,4)) : trade.건축년도;
    const 입주년차 = new Date().getFullYear() - 준공연도;

    // 신규거래 탭 필터: 10년 이내 신축, 400세대 이상
    if (입주년차 > 10 || 세대수 < 400) continue;

    const 거래가 = trade.거래금액 || trade.보증금액 || 0;
    const 이전최고가 = calcHighPrice(
      trade.type === '매매' ? allData.sale : allData.rent,
      trade.아파트, trade.법정동, trade.타입, trade.거래일
    );
    const 신고가 = 이전최고가 ? 거래가 > 이전최고가 : false;
    const 증감액 = 이전최고가 ? 거래가 - 이전최고가 : null;

    result.push({
      ...trade,
      세대수,
      준공연도,
      입주년차,
      이전최고가,
      신고가,
      증감액,
    });
  }

  return result;
}

module.exports = {
  collectAllTrades,
  extractNewTrades,
  buildNewTradesData,
  calcHighPrice,
  getAptType,
  getRecentMonths,
  saveData,
  loadData,
};
