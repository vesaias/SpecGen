import { useState } from "react";
import type { TableData } from "../../types";

interface Props {
  table: TableData;
  editable: boolean;
  onChange: (table: TableData) => void;
}

export default function TableBlock({ table, editable, onChange }: Props) {
  const { columns, rows } = table;

  function updateCell(rowIdx: number, colIdx: number, value: string) {
    const newRows = rows.map((row, ri) =>
      ri === rowIdx ? row.map((cell, ci) => (ci === colIdx ? value : cell)) : [...row],
    );
    onChange({ columns, rows: newRows });
  }

  function updateHeader(colIdx: number, value: string) {
    const newCols = columns.map((col, i) => (i === colIdx ? value : col));
    onChange({ columns: newCols, rows });
  }

  function addRow() {
    onChange({ columns, rows: [...rows, columns.map(() => "")] });
  }

  function removeRow(idx: number) {
    onChange({ columns, rows: rows.filter((_, i) => i !== idx) });
  }

  function addColumn() {
    onChange({
      columns: [...columns, `Column ${columns.length + 1}`],
      rows: rows.map((row) => [...row, ""]),
    });
  }

  function removeColumn(idx: number) {
    onChange({
      columns: columns.filter((_, i) => i !== idx),
      rows: rows.map((row) => row.filter((_, i) => i !== idx)),
    });
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm rounded-lg overflow-hidden">
          <thead>
            <tr>
              {columns.map((col, ci) => (
                <th
                  key={ci}
                  className="bg-stone-100/80 dark:bg-stone-800/80 text-left p-2.5 border border-stone-200/80 dark:border-stone-700 text-[11px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold"
                >
                  {editable ? (
                    <div className="flex items-center gap-1">
                      <input
                        value={col}
                        onChange={(e) => updateHeader(ci, e.target.value)}
                        className="bg-transparent outline-none w-full text-xs uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-400"
                      />
                      <button
                        type="button"
                        onClick={() => removeColumn(ci)}
                        className="text-stone-300 dark:text-stone-600 hover:text-red-500 dark:hover:text-red-400 text-xs flex-shrink-0"
                        title="Remove column"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    col
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-stone-50 dark:hover:bg-stone-800/50 group/row">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="p-2.5 border border-stone-200 dark:border-stone-700 align-top text-stone-800 dark:text-stone-200"
                  >
                    {editable ? (
                      <input
                        value={cell}
                        onChange={(e) => updateCell(ri, ci, e.target.value)}
                        className="bg-transparent outline-none w-full text-sm text-stone-800 dark:text-stone-200 placeholder:text-stone-400 dark:placeholder:text-stone-600"
                        placeholder="..."
                      />
                    ) : (
                      <span>{cell}</span>
                    )}
                  </td>
                ))}
                {editable && (
                  <td className="border-0 p-1 align-middle">
                    <button
                      type="button"
                      onClick={() => removeRow(ri)}
                      className="text-stone-300 dark:text-stone-600 hover:text-red-500 dark:hover:text-red-400 text-xs opacity-0 group-hover/row:opacity-100 transition-opacity"
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={addRow}
            className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 px-2 py-1 border border-dashed border-stone-300 dark:border-stone-700 rounded hover:border-stone-400 dark:hover:border-stone-500 transition-colors"
          >
            + Row
          </button>
          <button
            type="button"
            onClick={addColumn}
            className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 px-2 py-1 border border-dashed border-stone-300 dark:border-stone-700 rounded hover:border-stone-400 dark:hover:border-stone-500 transition-colors"
          >
            + Column
          </button>
        </div>
      )}
    </div>
  );
}
