#!/usr/bin/env node
/* eslint-disable no-console */
// ============================================================================
// 確認用の「見本の戸籍」を作る。
//
// 実機確認（pnpm qa:live の取り込み）と、手元での動作確認に使う。
// **本物の戸籍はリポジトリに置けない**ため、架空の家族で作る。
// 人名・本籍は法務省の記載例で慣例的に使われる架空のもの（甲野・乙野 など）。
//
//   a_zenbu_jiko.pdf / .png  … 現在の戸籍（全部事項証明・横書き・1枚）
//   b_kaisei_1〜3.png         … 改製原戸籍（縦書き・和暦は漢数字・3枚で1通）
//   b_kaisei.pdf              … 同じものを3ページのPDFにしたもの
//   *.expected.json           … 正解データ（pnpm benchmark 用）
//
// b_kaisei_3 の二男の死亡日は、わざと汚して読めなくしてある
// （「読み取り失敗」の赤字表示を確かめるため）。
//
// 実行: node scripts/make-sample-koseki.mjs
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const OUT = path.join(process.cwd(), 'e2e/live/fixtures/koseki-sample')
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

const FONT = `"IPAGothic", "IPAゴシック", "Noto Sans CJK JP", "Hiragino Sans", sans-serif`

const WATERMARK = `
  <div class="wm">見本</div>
  <div class="note">見本（架空の人物です。実在の人物・住所とは関係ありません）</div>`

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${FONT}; color: #111; background: #fff; }
  .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        font-size: 260px; color: rgba(200, 0, 0, 0.07); transform: rotate(-28deg); pointer-events: none; }
  .note { position: absolute; left: 0; right: 0; bottom: 18px; text-align: center; font-size: 13px; color: #b00; }
`

// ---------------------------------------------------------------------------
// A. 現在の戸籍（全部事項証明・横書き）
// ---------------------------------------------------------------------------
const personBlock = (rows, removed = false) => `
  <section class="person">
    <div class="label">戸籍に記録されている者${removed ? '<span class="removed">除　籍</span>' : ''}</div>
    <div class="rows">${rows.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>
  </section>`

const eventBlock = events => `
  <section class="events">
    <div class="label">身分事項</div>
    <div class="rows">${events
      .map(
        ([kind, items]) =>
          `<div class="event"><span class="kind">${kind}</span><div>${items
            .map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`)
            .join('')}</div></div>`
      )
      .join('')}</div>
  </section>`

const docA = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  .page { position: relative; width: 794px; height: 1123px; padding: 44px 52px; }
  h1 { text-align: center; font-size: 22px; letter-spacing: 14px; margin-bottom: 14px; }
  .top { border: 1.5px solid #333; }
  .top .row, .person .row, .events .row { display: flex; font-size: 12.5px; line-height: 1.6; }
  .top .row { border-bottom: 1px solid #999; padding: 4px 8px; }
  .top .row:last-child { border-bottom: none; }
  .top .k { width: 120px; letter-spacing: 6px; }
  section { display: flex; border: 1.5px solid #333; border-top: none; }
  .label { width: 150px; border-right: 1px solid #999; padding: 6px 8px; font-size: 12.5px; }
  .removed { display: inline-block; margin-top: 6px; border: 1px solid #333; padding: 0 6px; font-size: 11px; }
  .rows { flex: 1; padding: 4px 10px; }
  .k { width: 150px; flex-shrink: 0; }
  .event { display: flex; }
  .kind { width: 60px; flex-shrink: 0; font-size: 12.5px; line-height: 1.6; letter-spacing: 4px; }
  .end { text-align: center; font-size: 12px; margin-top: 10px; }
</style></head><body><div class="page">
  <h1>全部事項証明</h1>
  <div class="top">
    <div class="row"><span class="k">本籍</span><span class="v">東京都千代田区平河町一丁目10番地</span></div>
    <div class="row"><span class="k">氏名</span><span class="v">甲野　太郎</span></div>
  </div>
  <section><div class="label">戸籍事項</div><div class="rows"><div class="row"><span class="k">戸籍編製</span><span class="v">【編製日】昭和30年6月1日</span></div></div></section>
  ${personBlock([
    ['【名】', '太郎'],
    ['【生年月日】', '昭和2年10月6日　　【配偶者区分】夫'],
    ['【父】', '甲野義太郎'],
    ['【母】', '甲野梅子'],
    ['【続柄】', '長男'],
  ])}
  ${eventBlock([
    ['出生', [['【出生日】', '昭和2年10月6日'], ['【出生地】', '東京府東京市麹町区']]],
    ['婚姻', [['【婚姻日】', '昭和30年6月1日'], ['【配偶者氏名】', '乙野春子'], ['【従前戸籍】', '東京都千代田区平河町一丁目10番地　甲野義太郎']]],
    ['死亡', [['【死亡日】', '平成20年3月3日'], ['【死亡地】', '東京都千代田区']]],
  ])}
  ${personBlock([
    ['【名】', '春子'],
    ['【生年月日】', '昭和5年1月20日　　【配偶者区分】妻'],
    ['【父】', '乙野一郎'],
    ['【母】', '乙野和子'],
    ['【続柄】', '長女'],
  ])}
  ${eventBlock([
    ['出生', [['【出生日】', '昭和5年1月20日'], ['【出生地】', '神奈川県横浜市']]],
    ['婚姻', [['【婚姻日】', '昭和30年6月1日'], ['【配偶者氏名】', '甲野太郎'], ['【従前戸籍】', '神奈川県横浜市中区本町一丁目1番地　乙野一郎']]],
  ])}
  ${personBlock([
    ['【名】', '一郎'],
    ['【生年月日】', '昭和32年2月2日'],
    ['【父】', '甲野太郎'],
    ['【母】', '甲野春子'],
    ['【続柄】', '長男'],
  ])}
  ${eventBlock([['出生', [['【出生日】', '昭和32年2月2日'], ['【出生地】', '東京都千代田区']]]])}
  ${personBlock(
    [
      ['【名】', '愛子'],
      ['【生年月日】', '昭和35年12月24日'],
      ['【父】', '甲野太郎'],
      ['【母】', '甲野春子'],
      ['【続柄】', '長女'],
    ],
    true
  )}
  ${eventBlock([
    ['出生', [['【出生日】', '昭和35年12月24日'], ['【出生地】', '東京都千代田区']]],
    ['婚姻', [['【婚姻日】', '昭和60年4月1日'], ['【配偶者氏名】', '丙山健一'], ['【新本籍】', '埼玉県さいたま市浦和区高砂三丁目1番地']]],
  ])}
  <div class="end">以下余白</div>
  ${WATERMARK}
</div></body></html>`

// ---------------------------------------------------------------------------
// B. 改製原戸籍（縦書き・3枚）
// ---------------------------------------------------------------------------
// 1人分の欄: 右に身分事項（本文）、左端に 父・母・続柄・出生・名 の枠
const entry = ({ body, father, mother, relation, born, name, smudge = false }) => `
  <div class="entry">
    <div class="body">${body.map(line => `<p>${line}</p>`).join('')}${smudge ? '<div class="smudge"></div>' : ''}</div>
    <div class="meta">
      <div class="m"><span class="mk">父</span><span>${father}</span></div>
      <div class="m"><span class="mk">母</span><span>${mother}</span></div>
      <div class="m rel"><span>${relation}</span></div>
      <div class="m"><span class="mk">出生</span><span>${born}</span></div>
      <div class="m name"><span>${name}</span></div>
    </div>
  </div>`

const docBPage = (content, pageNo) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  .page { position: relative; width: 1400px; height: 1000px; padding: 48px 40px 56px; background: #fdfbf5; }
  .sheet { height: 100%; border: 2px solid #333; display: flex; flex-direction: row-reverse; }
  .head { writing-mode: vertical-rl; border-left: 2px solid #333; padding: 18px 10px; font-size: 20px; line-height: 2.1; }
  .head b { font-weight: normal; letter-spacing: 4px; }
  .entry { display: flex; flex-direction: row-reverse; border-left: 1.5px solid #555; }
  .body { position: relative; writing-mode: vertical-rl; padding: 16px 10px; font-size: 17px; line-height: 1.95; letter-spacing: 1px; }
  .body p { margin-left: 6px; }
  .meta { writing-mode: vertical-rl; display: flex; flex-direction: column; border-right: 1px solid #777; font-size: 16px; }
  .m { display: flex; padding: 6px 8px; border-top: 1px solid #aaa; line-height: 1.8; }
  .m:first-child { border-top: none; }
  .mk { margin-left: 6px; color: #444; }
  .rel { letter-spacing: 6px; }
  .name { font-size: 26px; letter-spacing: 10px; padding-top: 14px; }
  .smudge { position: absolute; left: 2px; top: 48px; width: 46px; height: 150px; border-radius: 40%;
            background: radial-gradient(ellipse, rgba(28,20,12,1) 62%, rgba(50,40,30,0.6) 82%, transparent 100%);
            filter: blur(2px); }
  .pageno { position: absolute; right: 44px; bottom: 30px; font-size: 13px; }
</style></head><body><div class="page">
  <div class="sheet">${content}</div>
  <div class="pageno">（${pageNo}／3）</div>
  ${WATERMARK}
</div></body></html>`

const headB = `
  <div class="head">
    <p><b>本籍</b>　東京都千代田区平河町一丁目拾番地</p>
    <p><b>氏名</b>　甲野　義太郎</p>
    <p>昭和参拾弐年法務省令第二十七号により昭和参拾六年拾月弐日本戸籍改製㊞</p>
  </div>`

const docB1 = docBPage(
  headB +
    entry({
      body: [
        '明治参拾五年五月拾日東京府東京市麹町区で出生父甲野源蔵届出同月拾五日受附入籍㊞',
        '大正拾五年参月拾日丁田梅子と婚姻届出同日受附㊞',
        '昭和四拾八年九月壱日午前拾時東京都千代田区で死亡同居者甲野太郎届出同月参日受附除籍㊞',
      ],
      father: '甲野源蔵',
      mother: 'ツル',
      relation: '長男',
      born: '明治参拾五年五月拾日',
      name: '義太郎',
    }),
  1
)

const docB2 = docBPage(
  entry({
    body: [
      '明治四拾年弐月参日神奈川県橘樹郡で出生父丁田平吉届出同月八日受附入籍㊞',
      '大正拾五年参月拾日甲野義太郎と婚姻届出同日神奈川県橘樹郡丁田平吉戸籍より入籍㊞',
      '昭和五拾五年壱月弐拾日午後参時東京都千代田区で死亡親族甲野太郎届出同月弐拾弐日受附除籍㊞',
    ],
    father: '丁田平吉',
    mother: 'キク',
    relation: '二女',
    born: '明治四拾年弐月参日',
    name: '妻　梅子',
  }) +
    entry({
      body: [
        '昭和弐年拾月六日東京市麹町区で出生父届出同月拾日受附入籍㊞',
        '昭和参拾年六月壱日乙野春子と婚姻届出同日受附東京都千代田区平河町一丁目拾番地に夫の氏の新戸籍編製につき除籍㊞',
      ],
      father: '甲野義太郎',
      mother: '梅子',
      relation: '長男',
      born: '昭和弐年拾月六日',
      name: '太郎',
    }),
  2
)

const docB3 = docBPage(
  entry({
    body: [
      '昭和五年四月拾五日東京市麹町区で出生父届出同月弐拾日受附入籍㊞',
      '昭和弐拾八年拾壱月参日乙川正夫と婚姻届出同日受附夫の氏の新戸籍編製につき除籍㊞',
    ],
    father: '甲野義太郎',
    mother: '梅子',
    relation: '長女',
    born: '昭和五年四月拾五日',
    name: '花子',
  }) +
    entry({
      body: [
        '昭和八年八月八日東京市麹町区で出生父届出同月拾弐日受附入籍㊞',
        // 死亡日の部分を汚してある（.smudge）。読めないのが正しい
        '昭和弐拾年参月拾日東京都千代田区で死亡父届出同月拾参日受附除籍㊞',
      ],
      father: '甲野義太郎',
      mother: '梅子',
      relation: '二男',
      born: '昭和八年八月八日',
      name: '次郎',
      smudge: true,
    }),
  3
)

// ---------------------------------------------------------------------------
// 正解データ（benchmark 用。FamilyTreeData 形式）
// ---------------------------------------------------------------------------
const person = (id, surname, given, sex, generation, relation, birth, death = [null, null, null]) => ({
  id,
  generation,
  sex,
  name: { surname, given_name: given },
  birth: { original_date: birth[0], date: birth[1], place: birth[2] },
  death: { original_date: death[0], date: death[1], place: death[2] },
  relation_to_family_head: relation,
})
const family = (id, parents, children, marriage = [null, null]) => ({
  id,
  parents,
  children,
  marriage_date: { original_date: marriage[0], date: marriage[1] },
  divorce_date: { original_date: null, date: null },
  relation_type: 'blood',
})

const expectedA = {
  people: [
    person('taro', '甲野', '太郎', 'male', 1, '夫', ['昭和2年10月6日', '1927-10-06', '東京府東京市麹町区'], ['平成20年3月3日', '2008-03-03', '東京都千代田区']),
    person('haruko', '甲野', '春子', 'female', 1, '妻', ['昭和5年1月20日', '1930-01-20', '神奈川県横浜市']),
    person('ichiro', '甲野', '一郎', 'male', 2, '長男', ['昭和32年2月2日', '1957-02-02', '東京都千代田区']),
    person('aiko', '甲野', '愛子', 'female', 2, '長女', ['昭和35年12月24日', '1960-12-24', '東京都千代田区']),
  ],
  families: [family('f1', ['taro', 'haruko'], ['ichiro', 'aiko'], ['昭和30年6月1日', '1955-06-01'])],
  registries: [
    { id: 'r1', registered_domicile: '東京都千代田区平河町一丁目10番地', head_of_family: '甲野太郎', registry_type: 'current', member_ids: ['taro', 'haruko', 'ichiro', 'aiko'] },
  ],
}

const expectedB = {
  people: [
    person('gitaro', '甲野', '義太郎', 'male', 1, '戸主', ['明治参拾五年五月拾日', '1902-05-10', '東京府東京市麹町区'], ['昭和四拾八年九月壱日', '1973-09-01', '東京都千代田区']),
    person('umeko', '甲野', '梅子', 'female', 1, '妻', ['明治四拾年弐月参日', '1907-02-03', '神奈川県橘樹郡'], ['昭和五拾五年壱月弐拾日', '1980-01-20', '東京都千代田区']),
    person('taro', '甲野', '太郎', 'male', 2, '長男', ['昭和弐年拾月六日', '1927-10-06', '東京市麹町区']),
    person('hanako', '甲野', '花子', 'female', 2, '長女', ['昭和五年四月拾五日', '1930-04-15', '東京市麹町区']),
    // 死亡日は汚してあり読めない。読めないと答えるのが正解
    person('jiro', '甲野', '次郎', 'male', 2, '二男', ['昭和八年八月八日', '1933-08-08', '東京市麹町区']),
  ],
  families: [family('f1', ['gitaro', 'umeko'], ['taro', 'hanako', 'jiro'], ['大正拾五年参月拾日', '1926-03-10'])],
  registries: [
    { id: 'r1', registered_domicile: '東京都千代田区平河町一丁目拾番地', head_of_family: '甲野義太郎', registry_type: 'revised', member_ids: ['gitaro', 'umeko', 'taro', 'hanako', 'jiro'] },
  ],
}

// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EXECUTABLE })
  const page = await browser.newPage({ deviceScaleFactor: 2 })

  const shoot = async (html, width, height, file) => {
    await page.setViewportSize({ width, height })
    await page.setContent(html, { waitUntil: 'load' })
    await page.screenshot({ path: path.join(OUT, file), fullPage: false })
    console.log(`  ${file}`)
  }

  console.log(`見本の戸籍を作成: ${path.relative(process.cwd(), OUT)}`)
  await shoot(docA, 794, 1123, 'a_zenbu_jiko.png')
  await page.setContent(docA, { waitUntil: 'load' })
  await page.pdf({ path: path.join(OUT, 'a_zenbu_jiko.pdf'), width: '794px', height: '1123px', printBackground: true })
  console.log('  a_zenbu_jiko.pdf')

  const pagesB = [docB1, docB2, docB3]
  for (const [i, html] of pagesB.entries()) await shoot(html, 1400, 1000, `b_kaisei_${i + 1}.png`)

  // 3ページのPDF（ページ区切りで連結する）
  const bodies = pagesB.map(html => html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')))
  const styles = pagesB[0].slice(pagesB[0].indexOf('<style>'), pagesB[0].indexOf('</style>') + 8)
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8">${styles}<style>.page{page-break-after:always}</style></head><body>${bodies.join('')}</body></html>`,
    { waitUntil: 'load' }
  )
  await page.pdf({ path: path.join(OUT, 'b_kaisei.pdf'), width: '1400px', height: '1000px', printBackground: true })
  console.log('  b_kaisei.pdf')

  fs.writeFileSync(path.join(OUT, 'a_zenbu_jiko.expected.json'), JSON.stringify(expectedA, null, 2) + '\n')
  fs.writeFileSync(path.join(OUT, 'b_kaisei.expected.json'), JSON.stringify(expectedB, null, 2) + '\n')
  console.log('  a_zenbu_jiko.expected.json / b_kaisei.expected.json')

  await browser.close()
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
