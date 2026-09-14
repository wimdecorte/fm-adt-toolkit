import { describe, it, expect } from 'vitest';
import { parseXml } from '../src/gaps/xml-walk.ts';

const DOC = `<?xml version="1.0" encoding="UTF-8"?>
<!-- header comment -->
<FMSaveAsXML version="2.3.0.0" Source="26.0.2" File="Ooe.fmp12">
  <Structure>
    <LayoutCatalog>
      <Layout id="11" name="File &amp; Open" width="740">
        <Options/>
        <Part type="Body" kind="4"><Definition type="Body" size="450" Options="1024"/></Part>
        <Calculation><![CDATA[If ( 1 < 2 ; "a" ; "b" )]]></Calculation>
        <Text>plain &lt;text&gt; here</Text>
      </Layout>
    </LayoutCatalog>
  </Structure>
</FMSaveAsXML>`;

describe('parseXml', () => {
  it('builds the tree with attributes, CDATA, entities and self-closing tags', () => {
    const root = parseXml(DOC);
    expect(root.tag).toBe('FMSaveAsXML');
    expect(root.attrs.Source).toBe('26.0.2');
    const layout = root.children[0].children[0].children[0];
    expect(layout.tag).toBe('Layout');
    expect(layout.attrs.name).toBe('File & Open');
    expect(layout.children.map((c) => c.tag)).toEqual(['Options', 'Part', 'Calculation', 'Text']);
    expect(layout.children[1].children[0].attrs.Options).toBe('1024');
    expect(layout.children[2].text).toBe('If ( 1 < 2 ; "a" ; "b" )');
    expect(layout.children[3].text).toBe('plain <text> here');
  });
  it('rejects a document whose tags do not balance', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/expected <\/b> but found <\/a>/);
  });
  it('does not truncate the tag at an unescaped > inside a quoted attribute value', () => {
    const root = parseXml('<Layout id="1" name="A > B" note=\'x>y\'><Part type="Body"/></Layout>');
    expect(root.attrs.name).toBe('A > B');
    expect(root.attrs.note).toBe('x>y');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].tag).toBe('Part');
  });
  it('parses a 5 MB document in bounded time', () => {
    const big = '<R>' + '<S id="1"><T x="y">t</T></S>'.repeat(120000) + '</R>';
    const t0 = Date.now();
    const r = parseXml(big);
    expect(r.children).toHaveLength(120000);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
