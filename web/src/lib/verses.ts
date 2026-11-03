export interface Verse {
  head: string
  lead: string
  from: string
}

const VERSES: readonly Verse[] = [
  { head: '北斗七星', lead: '高', from: '西鄙人《哥舒歌》' },
  { head: '星垂', lead: '平野阔', from: '杜甫《旅夜书怀》' },
  { head: '星汉', lead: '灿烂', from: '曹操《观沧海》' },
  { head: '天阶夜色', lead: '凉如水', from: '杜牧《秋夕》' },
  { head: '星河欲转', lead: '千帆舞', from: '李清照《渔家傲》' },
  { head: '大漠', lead: '孤烟直', from: '王维《使至塞上》' },
  { head: '落霞与', lead: '孤鹜齐飞', from: '王勃《滕王阁序》' },
  { head: '千山', lead: '鸟飞绝', from: '柳宗元《江雪》' },
  { head: '何处春江', lead: '无月明', from: '张若虚《春江花月夜》' },
  { head: '也无风雨', lead: '也无晴', from: '苏轼《定风波》' },
  { head: '山月', lead: '不知心里事', from: '温庭筠《梦江南》' },
  { head: '长风破浪', lead: '会有时', from: '李白《行路难》' },
  { head: '疑是银河', lead: '落九天', from: '李白《望庐山瀑布》' },
]

export function randomVerse(exclude?: Verse): Verse {
  const pool = exclude ? VERSES.filter((verse) => verse !== exclude) : VERSES
  return pool[Math.floor(Math.random() * pool.length)]!
}
