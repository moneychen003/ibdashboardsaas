#!/usr/bin/env python3
"""
IB FlexQuery XML 合并器
将新的单日/短期 XML 合并到历史主存档中，按日期去重、排序。
"""

import xml.etree.ElementTree as ET
import sys
import copy
from datetime import datetime


def parse_statements(xml_file):
    """解析 XML，返回 {fromDate: FlexStatement_element} 的字典"""
    tree = ET.parse(xml_file)
    root = tree.getroot()
    
    statements = {}
    for stmt in root.findall('.//FlexStatement'):
        from_date = stmt.get('fromDate')
        if from_date:
            statements[from_date] = stmt
    return statements, root


def merge_xml(master_file, new_file, output_file=None):
    """合并两个 IB Flex XML"""
    if output_file is None:
        output_file = master_file
    
    # 解析主存档和新数据
    master_statements, master_root = parse_statements(master_file)
    new_statements, new_root = parse_statements(new_file)
    
    # 获取根节点属性（优先使用新文件的 queryName）
    query_name = new_root.get('queryName', master_root.get('queryName', 'merged'))
    query_type = new_root.get('type', master_root.get('type', 'AF'))
    
    # 合并：新数据覆盖旧数据
    merged = dict(master_statements)
    for date, stmt in new_statements.items():
        merged[date] = stmt
    
    # 按 fromDate 排序
    sorted_dates = sorted(merged.keys())
    
    # 创建新的根节点
    new_root_elem = ET.Element('FlexQueryResponse')
    new_root_elem.set('queryName', query_name)
    new_root_elem.set('type', query_type)
    
    flex_statements = ET.SubElement(new_root_elem, 'FlexStatements')
    flex_statements.set('count', str(len(sorted_dates)))
    
    for date in sorted_dates:
        # deep copy 元素，避免与原树关联
        stmt_copy = copy.deepcopy(merged[date])
        flex_statements.append(stmt_copy)
    
    # 写入文件，保留 XML 声明和换行
    tree = ET.ElementTree(new_root_elem)
    ET.indent(tree, space='  ', level=0)
    tree.write(output_file, encoding='utf-8', xml_declaration=True)
    
    print(f"✅ 合并完成")
    print(f"   主存档原有：{len(master_statements)} 条")
    print(f"   新数据：{len(new_statements)} 条")
    new_count = len([d for d in new_statements if d not in master_statements])
    updated_count = len([d for d in new_statements if d in master_statements])
    print(f"   新增：{new_count} 条")
    print(f"   覆盖更新：{updated_count} 条")
    print(f"   合并后总计：{len(sorted_dates)} 条")
    print(f"   日期范围：{sorted_dates[0]} ~ {sorted_dates[-1]}")
    print(f"   输出文件：{output_file}")


def main():
    if len(sys.argv) < 3:
        print("用法：python3 merge_ib_xml.py <master_xml> <new_xml> [output_xml]")
        print("示例：python3 merge_ib_xml.py data/ib_history.xml data/ib_daily_20260408.xml")
        sys.exit(1)
    
    master_file = sys.argv[1]
    new_file = sys.argv[2]
    output_file = sys.argv[3] if len(sys.argv) > 3 else master_file
    
    merge_xml(master_file, new_file, output_file)


if __name__ == '__main__':
    main()
