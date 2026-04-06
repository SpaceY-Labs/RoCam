# RoCam Documentation

This folder contains all project documentation for the RoCam system.

## Folder Structure

| Folder | Contents |
|--------|----------|
| `SRS/` | Software Requirements Specification |
| `HazardAnalysis/` | Hazard Analysis with FMEA and safety requirements |
| `Design/SoftArchitecture/` | Module Guide (MG) |
| `Design/SoftDetailedDes/` | Module Interface Specification (MIS) |
| `VnVPlan/` | Verification and Validation Plan |
| `VnVReport/` | Verification and Validation Report |
| `ProblemStatementAndGoals/` | Problem Statement and Goals |
| `DevelopmentPlan/` | Development Plan |
| `Extras/` | Extra deliverables (Circuit Design Report, ML Report) |
| `ReflectAndTrace/` | Reflection and Traceability Report |
| `Checklists/` | Final documentation checklists |
| `Presentations/` | Presentation materials and posters |

## Building PDFs

All `.tex` files are compiled automatically via GitHub Actions (`build-tex.yml`). To build locally:

```bash
# From the repo root
cd docs/<subfolder>
latexmk -pdf <filename>.tex
```
