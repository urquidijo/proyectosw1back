import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';
import { CreateGenerationRuleSetDto } from './dto/create-generation-rule-set.dto';
import { UpdateGenerationRuleSetDto } from './dto/update-generation-rule-set.dto';

@Injectable()
export class GenerationRulesService {
    constructor(private readonly prisma: PrismaService) { }

    async create(
        projectId: string,
        userId: string,
        dto: CreateGenerationRuleSetDto,
    ) {
        await this.ensureProjectBelongsToUser(projectId, userId);

        const sqlImport = await this.ensureValidSqlImport(
            projectId,
            dto.sqlImportId,
        );

        const schema = sqlImport.schemaJson as unknown as DetectedSchema;

        this.validateRulesAgainstSchema(schema, dto.rulesJson);

        if (dto.isDefault) {
            await this.clearDefaultRuleSets(projectId, dto.sqlImportId);
        }

        const ruleSet = await this.prisma.generationRuleSet.create({
            data: {
                projectId,
                sqlImportId: dto.sqlImportId,
                name: dto.name,
                description: dto.description,
                rulesJson: dto.rulesJson as unknown as Prisma.InputJsonValue,
                isDefault: dto.isDefault ?? false,
            },
        });

        return ruleSet;
    }

    async findAllByProject(projectId: string, userId: string) {
        await this.ensureProjectBelongsToUser(projectId, userId);

        return this.prisma.generationRuleSet.findMany({
            where: {
                projectId,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    async findAllBySqlImport(
        projectId: string,
        sqlImportId: string,
        userId: string,
    ) {
        await this.ensureProjectBelongsToUser(projectId, userId);

        return this.prisma.generationRuleSet.findMany({
            where: {
                projectId,
                sqlImportId,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    async findOne(projectId: string, ruleSetId: string, userId: string) {
        await this.ensureProjectBelongsToUser(projectId, userId);

        const ruleSet = await this.prisma.generationRuleSet.findFirst({
            where: {
                id: ruleSetId,
                projectId,
            },
        });

        if (!ruleSet) {
            throw new NotFoundException('Configuración de reglas no encontrada');
        }

        return ruleSet;
    }

    async update(
        projectId: string,
        ruleSetId: string,
        userId: string,
        dto: UpdateGenerationRuleSetDto,
    ) {
        await this.ensureProjectBelongsToUser(projectId, userId);

        const currentRuleSet = await this.prisma.generationRuleSet.findFirst({
            where: {
                id: ruleSetId,
                projectId,
            },
            include: {
                sqlImport: true,
            },
        });

        if (!currentRuleSet) {
            throw new NotFoundException('Configuración de reglas no encontrada');
        }

        if (!currentRuleSet.sqlImport.schemaJson) {
            throw new BadRequestException(
                'La importación SQL no tiene un esquema detectado',
            );
        }

        if (dto.rulesJson) {
            const schema =
                currentRuleSet.sqlImport.schemaJson as unknown as DetectedSchema;

            this.validateRulesAgainstSchema(schema, dto.rulesJson);
        }

        if (dto.isDefault) {
            await this.clearDefaultRuleSets(projectId, currentRuleSet.sqlImportId);
        }

        return this.prisma.generationRuleSet.update({
            where: {
                id: ruleSetId,
            },
            data: {
                name: dto.name,
                description: dto.description,
                rulesJson: dto.rulesJson as unknown as
                    | Prisma.InputJsonValue
                    | undefined,
                isDefault: dto.isDefault,
            },
        });
    }

    async remove(projectId: string, ruleSetId: string, userId: string) {
        await this.ensureProjectBelongsToUser(projectId, userId);

        const ruleSet = await this.prisma.generationRuleSet.findFirst({
            where: {
                id: ruleSetId,
                projectId,
            },
        });

        if (!ruleSet) {
            throw new NotFoundException('Configuración de reglas no encontrada');
        }

        await this.prisma.generationRuleSet.delete({
            where: {
                id: ruleSetId,
            },
        });

        return {
            message: 'Configuración de reglas eliminada correctamente',
        };
    }

    private async ensureProjectBelongsToUser(projectId: string, userId: string) {
        const project = await this.prisma.project.findFirst({
            where: {
                id: projectId,
                ownerId: userId,
            },
        });

        if (!project) {
            throw new NotFoundException('Proyecto no encontrado');
        }

        return project;
    }

    private async ensureValidSqlImport(projectId: string, sqlImportId: string) {
        const sqlImport = await this.prisma.sqlImport.findFirst({
            where: {
                id: sqlImportId,
                projectId,
            },
        });

        if (!sqlImport) {
            throw new NotFoundException('Importación SQL no encontrada');
        }

        if (sqlImport.status !== 'VALID') {
            throw new BadRequestException(
                'Solo se pueden configurar reglas sobre una importación SQL válida',
            );
        }

        if (!sqlImport.schemaJson) {
            throw new BadRequestException(
                'La importación SQL no tiene un esquema detectado',
            );
        }

        return sqlImport;
    }

    private async clearDefaultRuleSets(projectId: string, sqlImportId: string) {
        await this.prisma.generationRuleSet.updateMany({
            where: {
                projectId,
                sqlImportId,
                isDefault: true,
            },
            data: {
                isDefault: false,
            },
        });
    }

    private validateRulesAgainstSchema(
        schema: DetectedSchema,
        rulesJson: Record<string, unknown>,
    ) {
        if (!rulesJson || typeof rulesJson !== 'object') {
            throw new BadRequestException('Las reglas deben ser un objeto JSON');
        }

        const rules = rulesJson as {
            tables?: Record<
                string,
                {
                    rowCount?: number;
                    columns?: Record<string, unknown>;
                }
            >;
        };

        if (!rules.tables || typeof rules.tables !== 'object') {
            throw new BadRequestException(
                'Las reglas deben tener la propiedad "tables"',
            );
        }

        const schemaTables = new Map(
            schema.tables.map((table) => [table.name, table]),
        );

        for (const tableName of Object.keys(rules.tables)) {
            const schemaTable = schemaTables.get(tableName);

            if (!schemaTable) {
                throw new BadRequestException(
                    `La tabla "${tableName}" no existe en el esquema SQL`,
                );
            }

            const tableRules = rules.tables[tableName];

            if (
                tableRules.rowCount !== undefined &&
                (!Number.isInteger(tableRules.rowCount) || tableRules.rowCount < 1)
            ) {
                throw new BadRequestException(
                    `La cantidad de filas para la tabla "${tableName}" debe ser un entero mayor a 0`,
                );
            }

            if (tableRules.rowCount !== undefined && tableRules.rowCount > 5000) {
                throw new BadRequestException(
                    `Por ahora el máximo permitido es 5000 filas para la tabla "${tableName}"`,
                );
            }

            if (tableRules.columns) {
                const schemaColumns = new Set(
                    schemaTable.columns.map((column) => column.name),
                );

                for (const columnName of Object.keys(tableRules.columns)) {
                    if (!schemaColumns.has(columnName)) {
                        throw new BadRequestException(
                            `La columna "${columnName}" no existe en la tabla "${tableName}"`,
                        );
                    }
                }
            }
        }
    }
}