# -*- coding: utf-8 -*-
"""產生「拖進來」的測試檔（全是虛構的人，內容裡的個資都是假的）。
   python web/worker/e2e/fixtures/make_fixtures.py
docx 自己用 zipfile 組（不靠 python-docx），順便涵蓋：表格、tab、換行、XML 跳脫、文字方塊的 Fallback 重複、
以及 stored（不壓縮）與 deflate 兩種 zip 方法。"""
import sys
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).parent

LINES = [
    "林大明",
    "Email: lin.daming@example.com　手機: 0912-345-678",
    "地址：台北市示範區虛構路 100 號",
    "",
    "工作經歷",
    "星海科技 資深工程師 2019–2025",
    "負責後端服務設計，帶領三人小組，撰寫內部技術文件與教學。",
    "曾在公司內部讀書會分享 R&D 流程 <v2> 與 \"code review\" 心得。",
    "",
    "學歷",
    "國立示範大學 資訊工程學系 學士",
    "",
    "專長",
    "Python、資料庫設計、專案管理、技術寫作、圖書館系統整合",
]

TXT = "\n".join(LINES) + "\n"
(HERE / "resume.txt").write_text(TXT, encoding="utf-8")
(HERE / "resume-big5.txt").write_bytes(TXT.encode("big5", errors="replace"))
(HERE / "too-short.txt").write_text("太短了。\n", encoding="utf-8")
(HERE / "resume.md").write_text("# 履歷\n\n" + TXT, encoding="utf-8")


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def para(s):
    return f'<w:p><w:r><w:t xml:space="preserve">{esc(s)}</w:t></w:r></w:p>'


body = []
for s in LINES[:4]:
    body.append(para(s))
# tab 與換行
body.append('<w:p><w:r><w:t>星海科技</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>資深工程師</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>2019–2025</w:t></w:r></w:p>')
# 表格：兩列兩欄
body.append('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>學歷</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>國立示範大學 資訊工程學系 學士</w:t></w:r></w:p></w:tc></w:tr>'
            '<w:tr><w:tc><w:p><w:r><w:t>專長</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Python、資料庫設計、專案管理、技術寫作</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
# 文字方塊：Word 會寫 Choice 與 Fallback 兩份，只該讀到一份
body.append('<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>'
            '<w:p><w:r><w:t>文字方塊裡的一句話</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice>'
            '<mc:Fallback><w:pict><v:textbox><w:txbxContent><w:p><w:r><w:t>文字方塊裡的一句話</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback>'
            '</mc:AlternateContent></w:r></w:p>')
for s in LINES[6:9]:
    body.append(para(s))
# 被刪除的修訂文字不該出現
body.append('<w:p><w:del><w:r><w:delText>已刪除的字</w:delText></w:r></w:del><w:r><w:t>保留的字</w:t></w:r></w:p>')

DOC = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
       'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
       'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
       'xmlns:v="urn:schemas-microsoft-com:vml"><w:body>' + "".join(body) + '</w:body></w:document>')
CT = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" '
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')


def make(path, method):
    with zipfile.ZipFile(path, "w", method) as z:
        z.writestr("[Content_Types].xml", CT)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/document.xml", DOC)


make(HERE / "resume.docx", zipfile.ZIP_DEFLATED)
make(HERE / "resume-stored.docx", zipfile.ZIP_STORED)
(HERE / "not-really.docx").write_bytes(b"this is not a zip file at all" * 5)
(HERE / "old.doc").write_bytes(b"\xd0\xcf\x11\xe0" + b"\0" * 100)
print("ok:", sorted(p.name for p in HERE.iterdir() if p.name != "make_fixtures.py"))
