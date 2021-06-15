import os
import csv
import json
import sqlite3

JSON_PATH = './v1.json'

def convert(filetype, filepath):
    data = None
    with open(JSON_PATH) as f:
        data = json.load(f)

    if os.path.exists(filepath):
        os.remove(filepath)

    if filetype == 'sqlite':
        convert_to_sqlite(data, filepath)
    elif filetype == 'csv':
        convert_to_csv(data, filepath)
    else:
        print('unknown file type')

def convert_to_csv(data, filepath):
    with open(filepath, 'w', newline='\n') as f:
        writer = csv.writer(f, delimiter=',', quotechar='|', quoting=csv.QUOTE_MINIMAL)
        for i, (sheet, rows) in enumerate(data.items()):
            if len(rows) == 0:
                continue
            headers = list(rows[0].keys())
            writer.writerow(headers)
            for row in rows:
                writer.writerow(list(row.values()))

def convert_to_sqlite(data, filepath):
    con = sqlite3.connect(filepath)
    cur = con.cursor()
    for i, (table, rows) in enumerate(data.items()):
        if len(rows) == 0:
            continue
        cols = ' text, '.join(rows[0].keys()) + ' text'
        cur.execute(f'create table {table} ({cols})')
        for row in rows:
            values = ", ".join([f'"{v}"' for v in row.values()])
            cur.execute(f'insert into {table} values ({values})') 
    con.commit()
    con.close()

convert('sqlite', './v1.sqlite')

