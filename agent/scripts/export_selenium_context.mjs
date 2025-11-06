#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const outDir = path.join('agent', 'exports');
const outputPath = path.join(outDir, 'selenium_test_context.md');

const readJson = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
};

const lmapPath = path.join(outDir, 'laravel_map.json');
const routesPath = path.join(outDir, 'routes.json');
const manifestPath = path.join(outDir, 'project_manifest.json');

const laravelMap = readJson(lmapPath);
const routesJson = readJson(routesPath);
const manifest = readJson(manifestPath);

const projectName = manifest?.name ?? 'Proyecto';

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

ensureDir(outDir);

const viewEntries = Array.isArray(laravelMap?.views?.blades) ? laravelMap.views.blades : [];
const controllerEntries = Array.isArray(laravelMap?.http?.controllers) ? laravelMap.http.controllers : [];

const normalizePath = (p) => p.replace(/\\/g, '/');

const extractIncludes = (content) => {
    const includes = [];
    const token = '@include(';
    let index = 0;
    while (index < content.length) {
        const found = content.indexOf(token, index);
        if (found === -1) {
            break;
        }
        let cursor = found + token.length;
        const nameMatch = content.slice(cursor).match(/^\s*['"]([^'"]+)['"]\s*,/s);
        if (!nameMatch) {
            index = cursor;
            continue;
        }
        const includeName = nameMatch[1];
        cursor += nameMatch[0].length;
        const arrayStart = content.indexOf('[', cursor);
        if (arrayStart === -1) {
            index = cursor;
            continue;
        }
        let depth = 0;
        let stop = arrayStart;
        while (stop < content.length) {
            const ch = content[stop];
            if (ch === '[') {
                depth += 1;
            } else if (ch === ']') {
                depth -= 1;
                if (depth === 0) {
                    break;
                }
            }
            stop += 1;
        }
        if (depth !== 0) {
            index = stop + 1;
            continue;
        }
        const arrayEnd = stop;
        const arrayContent = content.slice(arrayStart + 1, arrayEnd);
        const closeParen = content.indexOf(')', arrayEnd);
        const includeEnd = closeParen === -1 ? arrayEnd + 1 : closeParen + 1;
        includes.push({
            name: includeName,
            params: arrayContent,
            start: found,
            arrayStart,
            arrayEnd,
            end: includeEnd,
        });
        index = includeEnd;
    }
    return includes;
};

const parsePhpArrayScalar = (haystack, key) => {
    const regex = new RegExp(`${key.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}\\s*=>\\s*(['\`"])(.*?)\\1`, 's');
    const match = haystack.match(regex);
    return match ? match[2] : null;
};

const parsePhpArrayBoolean = (haystack, key) => {
    const regex = new RegExp(`${key.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}\\s*=>\\s*(true|false)`, 'i');
    const match = haystack.match(regex);
    return match ? match[1].toLowerCase() === 'true' : null;
};

const summarizeRemoteSelect = (params) => {
    const name = parsePhpArrayScalar(params, "'name'");
    const id = parsePhpArrayScalar(params, "'id'");
    const label = parsePhpArrayScalar(params, "'label'");
    const placeholder = parsePhpArrayScalar(params, "'placeholder'");
    const required = parsePhpArrayBoolean(params, "'required'");
    const configRaw = params.match(/'config'\s*=>\s*\[([\s\S]*)$/);

    return {
        type: 'component-remote-select',
        id,
        name,
        label,
        placeholder,
        required,
        config: configRaw ? configRaw[1].trim() : null,
    };
};

const extractFormFields = (formBody) => {
    const fields = [];
    const inputs = Array.from(formBody.matchAll(/<input\b[^>]*>/gi));
    inputs.forEach((match) => {
        const tag = match[0];
        const name = (tag.match(/name\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
        const id = (tag.match(/id\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
        const type = (tag.match(/type\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || 'text';
        const required = /required\b/i.test(tag);
        fields.push({
            element: 'input',
            type,
            name,
            id,
            required,
        });
    });

    const selects = Array.from(formBody.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi));
    selects.forEach((match) => {
        const tag = match[0];
        const name = (tag.match(/name\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
        const id = (tag.match(/id\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
        const required = /required\b/i.test(tag);
        fields.push({
            element: 'select',
            type: 'select',
            name,
            id,
            required,
        });
    });

    const textareas = Array.from(formBody.matchAll(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi));
    textareas.forEach((match) => {
        const tag = match[0];
        const name = (tag.match(/name\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
        const id = (tag.match(/id\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
        const required = /required\b/i.test(tag);
        fields.push({
            element: 'textarea',
            type: 'textarea',
            name,
            id,
            required,
        });
    });

    return fields;
};

const summarizeButtons = (formBody) => {
    const buttons = [];
    const buttonTags = Array.from(formBody.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi));
    buttonTags.forEach((match) => {
        const tag = match[0];
        const type = (tag.match(/type\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || 'submit';
        const id = (tag.match(/id\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
        const text = (tag.match(/>([\s\S]*?)<\/button>/i) || [])[1]?.trim().replace(/\s+/g, ' ') || '';
        buttons.push({ type, id, text });
    });

    const inputButtons = Array.from(formBody.matchAll(/<input\b[^>]*type\s*=\s*['"]submit['"][^>]*>/gi));
    inputButtons.forEach((match) => {
        const tag = match[0];
        const value = (tag.match(/value\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || '';
        const id = (tag.match(/id\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
        buttons.push({ type: 'submit', id, text: value });
    });

    return buttons;
};

const summarizeForm = (file, formMatch, includes) => {
    const fullForm = formMatch[0];
    const openingTag = fullForm.match(/<form\b[^>]*>/i)?.[0] ?? '<form>';
    const formBody = formMatch[1] ?? '';
    const id = (openingTag.match(/id\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
    const name = (openingTag.match(/name\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;
    const method = (openingTag.match(/method\s*=\s*['"]([^'"]+)['"]/i) || [])[1]?.toUpperCase() || 'GET';
    const action = (openingTag.match(/action\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null;

    const fields = extractFormFields(formBody);
    const buttons = summarizeButtons(formBody);

    const relatedComponents = includes
        .filter((inc) => inc.start >= formMatch.index && inc.end <= formMatch.index + fullForm.length)
        .map((inc) => inc.summary)
        .filter(Boolean);

    return {
        view: file,
        id,
        name,
        method,
        action,
        fields,
        buttons,
        components: relatedComponents,
    };
};

const analyzeView = (entry) => {
    const filePath = path.join(ROOT, normalizePath(entry.file));
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const includesRaw = extractIncludes(raw);

    const includes = includesRaw.map((inc) => {
        const summary = (inc.name === 'system.components.component-remote-select')
            ? summarizeRemoteSelect(inc.params)
            : null;
        return {
            name: inc.name,
            params: inc.params,
            summary,
            start: inc.start,
            end: inc.end,
        };
    });

    const forms = [];
    const regex = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
    let match;
    while ((match = regex.exec(raw))) {
        forms.push(summarizeForm(entry.file, match, includes));
    }

    return {
        file: entry.file,
        forms,
        includes: includes.map((inc) => ({
            name: inc.name,
            summary: inc.summary,
        })),
    };
};

const analyzedViews = viewEntries
    .map(analyzeView)
    .filter((v) => v && v.forms.length);

const routeSummary = (() => {
    if (!Array.isArray(routesJson)) {
        return null;
    }
    const uiRoutes = routesJson.filter((r) => r.method && /GET|HEAD/.test(r.method) && r.uri && !r.uri.startsWith('api'));
    return uiRoutes.map((r) => ({
        name: r.name || null,
        uri: r.uri,
        method: r.method,
        action: r.action,
    }));
})();

const formatField = (field) => {
    const parts = [];
    parts.push(`- \`${field.element}\``);
    if (field.type && field.type !== field.element) {
        parts.push(`tipo \`${field.type}\``);
    }
    if (field.name) {
        parts.push(`name=\`${field.name}\``);
    }
    if (field.id) {
        parts.push(`id=\`${field.id}\``);
    }
    if (field.required) {
        parts.push(`required`);
    }
    return parts.join(' · ');
};

const renderComponent = (component) => {
    if (!component) {
        return null;
    }
    const summary = component.summary ?? component;
    const props = [];
    if (summary.label) props.push(`label: \`${summary.label}\``);
    if (summary.name) props.push(`name: \`${summary.name}\``);
    if (summary.id) props.push(`id: \`${summary.id}\``);
    if (summary.placeholder) props.push(`placeholder: \`${summary.placeholder}\``);
    if (typeof summary.required === 'boolean') props.push(`required: ${summary.required ? 'sí' : 'no'}`);
    return `- component \`${summary.type}\`${props.length ? ` (${props.join(', ')})` : ''}`;
};

const renderUseCases = (form) => {
    const scenarios = [];
    const requiredFields = form.fields.filter((f) => f.required);
    if (form.components && form.components.length) {
        form.components.forEach((comp) => {
            const summary = comp?.summary ?? comp;
            if (summary?.type === 'component-remote-select') {
                const label = summary.label || summary.name || 'selector remoto';
                scenarios.push(`- [ ] Seleccionar opción válida en **${label}** y verificar persistencia.`);
                scenarios.push(`- [ ] Buscar por término parcial en **${label}** y validar lista filtrada.`);
                scenarios.push(`- [ ] Intentar continuar sin seleccionar **${label}** y confirmar mensaje requerido.`);
            }
        });
    }
    if (requiredFields.length) {
        const fieldNames = requiredFields.map((f) => f.name || f.id || f.element).filter(Boolean);
        scenarios.unshift(`- [ ] Flujo feliz completando: ${fieldNames.map((f) => `\`${f}\``).join(', ')}.`);
        requiredFields.forEach((field) => {
            const label = field.name || field.id || field.element;
            scenarios.push(`- [ ] Dejar vacío \`${label}\` para validar la restricción de requerido.`);
        });
    } else {
        scenarios.unshift('- [ ] Flujo feliz completando todos los campos visibles.');
    }
    form.fields.forEach((field) => {
        if (field.type === 'number') {
            const label = field.name || field.id || 'campo numérico';
            scenarios.push(`- [ ] Ingresar un valor fuera de rango en \`${label}\` y comprobar validación.`);
        }
        if (field.type === 'date') {
            const label = field.name || field.id || 'campo fecha';
            scenarios.push(`- [ ] Probar fecha inválida en \`${label}\` (pasado/futuro según negocio).`);
        }
    });
    scenarios.push('- [ ] Interrumpir el envío y confirmar que los datos permanecen visibles.');
    scenarios.push('- [ ] Reintentar el envío tras corregir errores y validar éxito.');
    return scenarios.join('\n');
};

const lines = [];
lines.push(`# Selenium Test Context · ${projectName}`);
lines.push('');
lines.push(`Generado automáticamente el ${new Date().toISOString()}.`);
lines.push('');
lines.push('Este recurso complementa los exports existentes para planificar y automatizar pruebas end-to-end con Selenium.');
lines.push('');

if (controllerEntries.length) {
    lines.push('## Controladores HTTP detectados');
    controllerEntries.forEach((ctrl) => {
        lines.push(`- ${normalizePath(ctrl)}`);
    });
    lines.push('');
}

if (routeSummary && routeSummary.length) {
    lines.push('## Rutas web orientativas');
    routeSummary.slice(0, 40).forEach((route) => {
        lines.push(`- \`${route.method}\` ${route.uri}${route.name ? ` (route name: \`${route.name}\`)` : ''}`);
    });
    if (routeSummary.length > 40) {
        lines.push(`- ... (${routeSummary.length - 40} rutas adicionales en agent/exports/routes.json)`);
    }
    lines.push('');
}

if (!analyzedViews.length) {
    lines.push('No se detectaron formularios en las vistas analizadas.');
} else {
    lines.push('## Formularios y componentes relevantes');
    analyzedViews.forEach((view) => {
        lines.push(`### ${normalizePath(view.file)}`);
        view.forms.forEach((form, idx) => {
            const hdr = form.id ? `Formulario \`${form.id}\`` : `Formulario ${idx + 1}`;
            lines.push(`#### ${hdr}`);
            lines.push(`- Método: \`${form.method}\``);
            lines.push(`- Acción: ${form.action ? `\`${form.action}\`` : '_sin especificar_ (usa URL actual)'}`);
            if (form.name) {
                lines.push(`- Name: \`${form.name}\``);
            }
            if (form.fields.length) {
                lines.push('- Campos detectados:');
                form.fields.forEach((field) => {
                    lines.push(`  ${formatField(field)}`);
                });
            }
            if (form.components && form.components.length) {
                lines.push('- Componentes embebidos:');
                form.components.forEach((component) => {
                    const rendered = renderComponent(component);
                    if (rendered) {
                        lines.push(`  ${rendered}`);
                    }
                });
            }
            if (form.buttons.length) {
                lines.push('- Botones relevantes:');
                form.buttons.forEach((btn) => {
                    lines.push(`  - tipo \`${btn.type}\`${btn.id ? ` · id=\`${btn.id}\`` : ''}${btn.text ? ` · texto="${btn.text}"` : ''}`);
                });
            }
            lines.push('');
            lines.push('**Checklist de escenarios sugeridos**');
            lines.push(renderUseCases(form));
            lines.push('');
            lines.push('**Notas para Selenium**');
            const selectors = [];
            if (form.id) selectors.push(`form[id="${form.id}"]`);
            form.fields.forEach((field) => {
                if (field.id) selectors.push(`#${field.id}`);
                else if (field.name) selectors.push(`[name="${field.name}"]`);
            });
            (form.components || []).forEach((component) => {
                const summary = component?.summary ?? component;
                if (summary?.id) selectors.push(`#${summary.id}`);
                else if (summary?.name) selectors.push(`[name="${summary.name}"]`);
            });
            lines.push(selectors.length ? `- Selectores recomendados: ${selectors.map((s) => `\`${s}\``).join(', ')}` : '- Revisar selectores manualmente.');
            lines.push('- Sugerencia: modelar Page Objects por sección e incluir métodos para completar campos obligatorios y validar toasts.');
            lines.push('');
        });
    });
}

lines.push('## Guía para generar código Selenium');
lines.push('- Utilizar Python 3 + pytest + selenium (webdriver-manager recomendado para drivers).');
lines.push('- Organizar el código en Page Objects (clases por página) con métodos claros.');
lines.push('- Reutilizar selectores recopilados arriba y parametrizar datos de prueba en fixtures.');
lines.push('- Incluir asserts explícitos para mensajes de éxito / validaciones.');
lines.push('- Documentar escenarios adicionales en esta plantilla cuando surjan nuevos flujos.');
lines.push('');

lines.push('## Casos de uso adicionales (completar por el agente)');
lines.push('- [ ] Flujo de login y navegación previa a cada formulario.');
lines.push('- [ ] Interacciones con modales o confirmaciones si aplican.');
lines.push('- [ ] Descarga / subida de archivos cuando existan.');
lines.push('- [ ] Validaciones de permisos / roles.');
lines.push('- [ ] Accesibilidad básica (tab order, focus).');

fs.writeFileSync(outputPath, lines.join('\n'));

console.log(JSON.stringify({
    viewsWithForms: analyzedViews.length,
    output: outputPath,
}, null, 2));
