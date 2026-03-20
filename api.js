const axios = require('axios');
const xml2js = require('xml2js');

const parser = new xml2js.Parser({ explicitArray: false });
const parseXML = (xml) => parser.parseStringPromise(xml);

// ── 국토부 아파트 매매 실거래가 조회 ──────────────────────────
async function fetchSale(serviceKey, lawdCd, dealYmd) {
  const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${serviceKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const parsed = await parseXML(res.data);
    const items = parsed?.response?.body?.items?.item;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map(d => ({
      type: '매매',
      아파트: d['aptNm']?.trim() || '',
      법정동: d['umdNm']?.trim() || '',
      지번: d['jibun']?.trim() || '',
      전용면적: parseFloat(d['excluUseAr']) || 0,
      거래금액: parseInt((d['dealAmount'] || '0').replace(/,/g, '')) || 0,
      층: parseInt(d['floor']) || 0,
      건축년도: parseInt(d['buildYear']) || 0,
      년: parseInt(d['dealYear']) || 0,
      월: parseInt(d['dealMonth']) || 0,
      일: parseInt(d['dealDay']) || 0,
      거래일: `${d['dealYear']}-${String(d['dealMonth']).padStart(2,'0')}-${String(d['dealDay']).padStart(2,'0')}`,
      등록일: d['rgstDate']?.trim() || '',
      해제여부: d['cdealType']?.trim() || '',
    }));
  } catch(e) {
    console.error(`[매매 API 오류] ${lawdCd} ${dealYmd}:`, e.message);
    return [];
  }
}

// ── 국토부 아파트 전월세 조회 ──────────────────────────────────
async function fetchRent(serviceKey, lawdCd, dealYmd) {
  const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${serviceKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const parsed = await parseXML(res.data);
    const items = parsed?.response?.body?.items?.item;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map(d => ({
      type: parseInt(d['monthlyRent']) > 0 ? '월세' : '전세',
      아파트: d['aptNm']?.trim() || '',
      법정동: d['umdNm']?.trim() || '',
      지번: d['jibun']?.trim() || '',
      전용면적: parseFloat(d['excluUseAr']) || 0,
      보증금액: parseInt((d['deposit'] || '0').replace(/,/g, '')) || 0,
      월세금액: parseInt((d['monthlyRent'] || '0').replace(/,/g, '')) || 0,
      층: parseInt(d['floor']) || 0,
      건축년도: parseInt(d['buildYear']) || 0,
      년: parseInt(d['dealYear']) || 0,
      월: parseInt(d['dealMonth']) || 0,
      일: parseInt(d['dealDay']) || 0,
      거래일: `${d['dealYear']}-${String(d['dealMonth']).padStart(2,'0')}-${String(d['dealDay']).padStart(2,'0')}`,
      등록일: d['rgstDate']?.trim() || '',
    }));
  } catch(e) {
    console.error(`[전월세 API 오류] ${lawdCd} ${dealYmd}:`, e.message);
    return [];
  }
}

// ── 건축물대장 표제부 조회 (세대수, 준공일 등) ──────────────────
async function fetchBuildingInfo(serviceKey, sigunguCd, bjdongCd, bun, ji) {
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${serviceKey}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun||'0000'}&ji=${ji||'0000'}&numOfRows=10&pageNo=1&_type=json`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const items = res.data?.response?.body?.items?.item;
    if (!items) return null;
    const arr = Array.isArray(items) ? items : [items];
    const apt = arr.find(b => b.mainPurpsCdNm?.includes('아파트')) || arr[0];
    if (!apt) return null;
    return {
      세대수: parseInt(apt.hhldCnt) || 0,
      동수: parseInt(apt.dongCnt) || 0,
      준공일: apt.useAprDay || '',
      건물명: apt.bldNm || '',
      주소: apt.platPlc || '',
    };
  } catch(e) {
    console.error(`[건축물대장 API 오류]:`, e.message);
    return null;
  }
}

module.exports = { fetchSale, fetchRent, fetchBuildingInfo };
