import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { requireCsrf } from '../lib/csrf';
import { requireAuth, requireRole, requireSchoolId } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';

const router = Router();
const yearSchema = z.object({ name: z.string().trim().min(5), startsAt: z.coerce.date(), endsAt: z.coerce.date(), status: z.enum(['PREPARATION', 'ACTIVE', 'CLOSED']).optional() }).refine(v => v.endsAt > v.startsAt, { message: 'Dates invalides' });
const yearUpdateSchema = z.object({ name: z.string().trim().min(5).optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), status: z.enum(['PREPARATION', 'ACTIVE', 'CLOSED']).optional() });
const namedSchema = z.object({ name: z.string().trim().min(1), sortOrder: z.number().int().optional(), levelId: z.string().optional(), code: z.string().trim().min(1).optional() });
const classSchema = z.object({ name: z.string().trim().min(1), academicYearId: z.string(), levelId: z.string(), seriesId: z.string().nullable().optional() });
const classroomSubjectSchema = z.object({
  classroomId: z.string().min(1),
  subjectId: z.string().min(1),
  coefficient: z.union([z.coerce.number().min(0), z.string().min(1)]),
  effectiveTo: z.coerce.date().nullable().optional(),
});
router.use(requireAuth, requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'));

router.get('/years', asyncHandler(async (req,res)=>{const schoolId=requireSchoolId(req);res.json({ years: await prisma.academicYear.findMany({where:{schoolId,deletedAt:null},include:{semesters:true},orderBy:{startsAt:'desc'}})});}));
router.post('/years', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const data=yearSchema.parse(req.body);const year=await prisma.academicYear.create({data:{...data,schoolId}});await prisma.semester.createMany({data:[1,2].map(number=>({academicYearId:year.id,number,name:`Semestre ${number}`,startsAt:data.startsAt,endsAt:data.endsAt}))});await writeAuditLog({req,schoolId,userId:req.currentUser!.id,action:'ACADEMIC_YEAR_CREATED',entityType:'AcademicYear',entityId:year.id});res.status(201).json({year});}));
router.patch('/years/:id', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const year=await prisma.academicYear.findFirst({where:{id:req.params.id,schoolId,deletedAt:null}});if(!year)throw new HttpError(404,'Année introuvable');if(year.status==='CLOSED')throw new HttpError(409,"L'année scolaire est clôturée");const data=yearUpdateSchema.parse(req.body);res.json({year:await prisma.academicYear.update({where:{id:year.id},data})});}));
router.get('/levels', asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);res.json({levels:await prisma.level.findMany({where:{schoolId,deletedAt:null},orderBy:[{sortOrder:'asc'},{name:'asc'}]})});}));
router.post('/levels', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const data=namedSchema.parse(req.body);const level=await prisma.level.create({data:{schoolId,name:data.name,sortOrder:data.sortOrder??0}});res.status(201).json({level});}));
router.get('/series', asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);res.json({series:await prisma.series.findMany({where:{schoolId,deletedAt:null},include:{level:true},orderBy:{name:'asc'}})});}));
router.post('/series', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const data=namedSchema.parse(req.body);if(data.levelId&&!await prisma.level.findFirst({where:{id:data.levelId,schoolId,deletedAt:null}}))throw new HttpError(404,'Niveau introuvable');const series=await prisma.series.create({data:{schoolId,name:data.name,levelId:data.levelId}});res.status(201).json({series});}));
router.get('/classes', asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);res.json({classes:await prisma.classroom.findMany({where:{schoolId,deletedAt:null},include:{academicYear:true,level:true,series:true,_count:{select:{enrollments:{where:{status:'ACTIVE',deletedAt:null}}}}},orderBy:{name:'asc'}})});}));
router.post('/classes', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const data=classSchema.parse(req.body);const year=await prisma.academicYear.findFirst({where:{id:data.academicYearId,schoolId,deletedAt:null}});const level=await prisma.level.findFirst({where:{id:data.levelId,schoolId,deletedAt:null}});if(!year||!level)throw new HttpError(404,'Année ou niveau introuvable');if(year.status==='CLOSED')throw new HttpError(409,"L'année scolaire est clôturée");const classroom=await prisma.classroom.create({data:{...data,schoolId}});res.status(201).json({classroom});}));
router.get('/subjects', asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);res.json({subjects:await prisma.subject.findMany({where:{schoolId,deletedAt:null},orderBy:{name:'asc'}})});}));router.post('/subjects', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const data=namedSchema.extend({code:z.string().trim().min(1)}).parse(req.body);const subject=await prisma.subject.create({data:{schoolId,name:data.name,code:data.code}});res.status(201).json({subject});}));
/**
 * Affectations discipline / classe avec coefficient.
 * C'est sur une affectation que l'évaluation est créée (cf. routes/grades.ts),
 * et le coefficient de la ligne court sert de version effective à la date de calcul.
 */
router.get('/classroom-subjects', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const rows = await prisma.classroomSubject.findMany({
    where: { schoolId, ...(classroomId ? { classroomId } : {}) },
    include: { subject: true, classroom: true },
    orderBy: [{ classroom: { name: 'asc' } }, { subject: { name: 'asc' } }],
  });
  res.json({
    classroomSubjects: rows.map((row) => ({ ...row, coefficient: String(row.coefficient) })),
  });
}));

router.post('/classroom-subjects', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = classroomSubjectSchema.parse(req.body);
  const coefficient = Number(String(data.coefficient).replace(',', '.'));
  if (!Number.isFinite(coefficient) || coefficient < 0) {
    throw new HttpError(400, 'Coefficient invalide : nombre décimal positif attendu');
  }

  const [classroom, subject] = await Promise.all([
    prisma.classroom.findFirst({
      where: { id: data.classroomId, schoolId, deletedAt: null },
      include: { academicYear: true },
    }),
    prisma.subject.findFirst({ where: { id: data.subjectId, schoolId, deletedAt: null } }),
  ]);
  if (!classroom) throw new HttpError(404, 'Classe introuvable');
  if (!subject) throw new HttpError(404, 'Discipline introuvable');
  if (classroom.academicYear.status === 'CLOSED') {
    throw new HttpError(409, "L'année scolaire est clôturée");
  }

  const existante = await prisma.classroomSubject.findFirst({
    where: { classroomId: classroom.id, subjectId: subject.id, effectiveTo: null },
  });
  if (existante) {
    throw new HttpError(409, 'Cette discipline est déjà affectée à cette classe (modifiable en coefficient)');
  }

  const created = await prisma.classroomSubject.create({
    data: {
      schoolId,
      classroomId: classroom.id,
      subjectId: subject.id,
      coefficient: new Prisma.Decimal(String(coefficient)),
      ...(data.effectiveTo ? { effectiveTo: data.effectiveTo } : {}),
    },
    include: { subject: true, classroom: true },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'CLASSROOM_SUBJECT_CREATED',
    entityType: 'ClassroomSubject',
    entityId: created.id,
    metadata: { classroomId: classroom.id, subjectId: subject.id, coefficient: String(coefficient) },
  });
  res.status(201).json({ classroomSubject: { ...created, coefficient: String(created.coefficient) } });
}));

export const schoolingRouter=router;
