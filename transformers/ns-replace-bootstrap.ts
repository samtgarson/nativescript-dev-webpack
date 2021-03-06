import { dirname, relative } from 'path';
import * as ts from 'typescript';
import {
    StandardTransform,
    TransformOperation,
    collectDeepNodes,
    insertStarImport,
    ReplaceNodeOperation,
    makeTransform,
    getFirstNode
} from "@ngtools/webpack/src/transformers";
import { AngularCompilerPlugin } from '@ngtools/webpack';
import { getResolvedEntryModule } from "../utils/transformers-utils";


export function nsReplaceBootstrap(getNgCompiler: () => AngularCompilerPlugin): ts.TransformerFactory<ts.SourceFile> {
    const shouldTransform = (fileName) => !fileName.endsWith('.ngfactory.ts') && !fileName.endsWith('.ngstyle.ts');
    const getTypeChecker = () => getNgCompiler().typeChecker;

    const standardTransform: StandardTransform = function (sourceFile: ts.SourceFile) {
        const ops: TransformOperation[] = [];
        const entryModule = getResolvedEntryModule(getNgCompiler());

        if (!shouldTransform(sourceFile.fileName) || !entryModule) {
            return ops;
        }

        // Find all identifiers.
        const entryModuleIdentifiers = collectDeepNodes<ts.Identifier>(sourceFile,
            ts.SyntaxKind.Identifier)
            .filter(identifier => identifier.text === entryModule.className);

        if (entryModuleIdentifiers.length === 0) {
            return [];
        }

        const relativeEntryModulePath = relative(dirname(sourceFile.fileName), entryModule.path);
        const normalizedEntryModulePath = `./${relativeEntryModulePath}`.replace(/\\/g, '/');

        // Find the bootstrap calls.
        entryModuleIdentifiers.forEach(entryModuleIdentifier => {
            // Figure out if it's a `platformNativeScriptDynamic().bootstrapModule(AppModule)` call.
            if (!(
                entryModuleIdentifier.parent
                && entryModuleIdentifier.parent.kind === ts.SyntaxKind.CallExpression
            )) {
                return;
            }

            const callExpr = entryModuleIdentifier.parent as ts.CallExpression;

            if (callExpr.expression.kind !== ts.SyntaxKind.PropertyAccessExpression) {
                return;
            }

            const propAccessExpr = callExpr.expression as ts.PropertyAccessExpression;

            if (propAccessExpr.name.text !== 'bootstrapModule'
                || propAccessExpr.expression.kind !== ts.SyntaxKind.CallExpression) {
                return;
            }

            const bootstrapModuleIdentifier = propAccessExpr.name;
            const innerCallExpr = propAccessExpr.expression as ts.CallExpression;

            if (!(
                innerCallExpr.expression.kind === ts.SyntaxKind.Identifier
                && (innerCallExpr.expression as ts.Identifier).text === 'platformNativeScriptDynamic'
            )) {
                return;
            }

            const platformNativeScriptDynamicIdentifier = innerCallExpr.expression as ts.Identifier;

            const idPlatformNativeScript = ts.createUniqueName('__NgCli_bootstrap_');
            const idNgFactory = ts.createUniqueName('__NgCli_bootstrap_');

            const firstNode = getFirstNode(sourceFile);

            // Add the transform operations.
            const factoryClassName = entryModule.className + 'NgFactory';
            const factoryModulePath = normalizedEntryModulePath + '.ngfactory';
            ops.push(
                // Insert an import of the {N} Angular static bootstrap module in the beginning of the file:
                // import * as __NgCli_bootstrap_2 from "nativescript-angular/platform-static";
                ...insertStarImport(
                    sourceFile,
                    idPlatformNativeScript,
                    'nativescript-angular/platform-static',
                    firstNode,
                    true,
                ),

                // Insert an import of the module factory in the beginning of the file:
                // import * as __NgCli_bootstrap_1 from "./app.module.ngfactory";
                ...insertStarImport(
                    sourceFile,
                    idNgFactory,
                    factoryModulePath,
                    firstNode,
                    true,
                ),

                // Replace the NgModule nodes with NgModuleFactory nodes
                // from 'AppModule' to 'AppModuleNgFactory'
                new ReplaceNodeOperation(sourceFile, entryModuleIdentifier,
                    ts.createPropertyAccess(idNgFactory, ts.createIdentifier(factoryClassName))),

                // Replace 'platformNativeScriptDynamic' with 'platformNativeScript'
                // and elide all imports of 'platformNativeScriptDynamic'
                new ReplaceNodeOperation(sourceFile, platformNativeScriptDynamicIdentifier,
                    ts.createPropertyAccess(idPlatformNativeScript, 'platformNativeScript')),

                // Replace the invocation of 'boostrapModule' with 'bootsrapModuleFactory'
                new ReplaceNodeOperation(sourceFile, bootstrapModuleIdentifier,
                    ts.createIdentifier('bootstrapModuleFactory')),
            );
        });

        return ops;
    };

    return makeTransform(standardTransform, getTypeChecker);
}
